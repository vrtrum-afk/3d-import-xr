import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory'
import './App.css'

// ─────────────────────────────────────────────────────────────────────────────
//  UNIT SYSTEM
//
//  After loading an env, we compute:
//    metreInUnits = (scaled longest axis of env) / envRealMetres
//
//  All positions in ENV_CONFIG are in real metres.
//  At runtime they are multiplied by metreInUnits to get world units.
//
//  Model is always scaled to MODEL_HEIGHT_M tall.
//  Camera eye is always EYE_HEIGHT_M above floor → perfectly horizontal gaze.
// ─────────────────────────────────────────────────────────────────────────────

const MODEL_HEIGHT_M = 1.70
const EYE_HEIGHT_M   = 1.60

// envRealMetres: the real-world width (metres) the env represents.
// camPos / tgtPos / modelPos: in metres, relative to env centre (XZ).
// Increase camPos.z to move camera farther from model.
const ENV_CONFIG = {
  room1: {
    envRealMetres: 12,
    camPos:   { x:  0, z:  4 },
    tgtPos:   { x:  0, z: -1 },
    modelPos: { x:  0, z: -2 },
    modelRotY: Math.PI,
  },
  room2: {
    envRealMetres: 12,
    camPos:   { x:  0, z:  4 },
    tgtPos:   { x:  0, z: -1 },
    modelPos: { x:  0, z: -2 },
    modelRotY: Math.PI,
  },
  room3: {
    envRealMetres: 12,
    camPos:   { x:  0, z:  4 },
    tgtPos:   { x:  0, z: -1 },
    modelPos: { x:  0, z: -2 },
    modelRotY: Math.PI,
  },
}

export default function App() {
  const mountRef = useRef(null)
  const [activeModel, setActiveModel] = useState('default')
  const [activeEnv,   setActiveEnv]   = useState('room1')
  const [envScaleUI,  setEnvScaleUI]  = useState(45)

  useEffect(() => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x111111)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1e7)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.xr.enabled = true
    renderer.xr.setReferenceSpaceType('local-floor')

    const container = mountRef.current
    container.innerHTML = ''
    container.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2))
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))

    // Fallback floor (hidden once env loaded)
    const fallbackFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(1e6, 1e6),
      new THREE.MeshStandardMaterial({ color: 0x222222 })
    )
    fallbackFloor.rotation.x = -Math.PI / 2
    scene.add(fallbackFloor)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping      = true
    controls.dampingFactor      = 0.08
    controls.screenSpacePanning = true

    const playerRig = new THREE.Group()
    scene.add(playerRig)
    playerRig.add(camera)

    // ── Runtime state ────────────────────────────────────────────────────────
    let mixer        = null
    let currentModel = null
    let environment  = null
    let lastEnvPath  = '/env/room1.glb'
    let lastEnvKey   = 'room1'
    let envZoom      = 45

    // Computed each time an env loads
    let metreInUnits = 100
    let camWorldPos  = new THREE.Vector3()
    let tgtWorldPos  = new THREE.Vector3()
    let modelWorldPos = new THREE.Vector3()
    let modelRotY    = Math.PI

    const loader = new GLTFLoader()
    const clock  = new THREE.Clock()

    // ── Utilities ────────────────────────────────────────────────────────────
    function getFloorY(x, z) {
      const rc = new THREE.Raycaster()
      rc.ray.origin.set(x, 1e7, z)
      rc.ray.direction.set(0, -1, 0)
      const targets = environment ? [environment, fallbackFloor] : [fallbackFloor]
      const hits = rc.intersectObjects(targets, true)
      return hits.length ? hits[0].point.y : 0
    }

    // ── Camera placement ─────────────────────────────────────────────────────
    function placeCamera() {
      const floorAtCam = getFloorY(camWorldPos.x, camWorldPos.z)
      const floorAtTgt = getFloorY(tgtWorldPos.x, tgtWorldPos.z)
      const eyeY = floorAtCam + EYE_HEIGHT_M * metreInUnits
      const tgtY = floorAtTgt + EYE_HEIGHT_M * metreInUnits  // same height → horizontal

      camera.position.set(camWorldPos.x, eyeY, camWorldPos.z)
      controls.target.set(tgtWorldPos.x, tgtY, tgtWorldPos.z)
      controls.update()

      // Store for VR
      camWorldPos.y = eyeY
      tgtWorldPos.y = tgtY
    }

    // ── Model placement ──────────────────────────────────────────────────────
    function placeModel(model) {
      // Reset
      model.scale.set(1, 1, 1)
      model.position.set(0, 0, 0)
      model.rotation.set(0, modelRotY, 0)
      model.updateMatrixWorld(true)

      // Measure raw height
      const b0   = new THREE.Box3().setFromObject(model)
      const rawH = b0.getSize(new THREE.Vector3()).y
      if (!rawH) return

      // Scale to MODEL_HEIGHT_M
      const s = (MODEL_HEIGHT_M * metreInUnits) / rawH
      model.scale.set(s, s, s)
      model.updateMatrixWorld(true)

      // Position XZ
      model.position.x = modelWorldPos.x
      model.position.z = modelWorldPos.z
      model.position.y = 0
      model.updateMatrixWorld(true)

      // Snap feet: move up so bounding box min.y == floor surface
      const b1     = new THREE.Box3().setFromObject(model)
      const floorY = getFloorY(modelWorldPos.x, modelWorldPos.z)
      model.position.y = floorY - b1.min.y
      model.updateMatrixWorld(true)
    }

    function loadModel(path) {
      loader.load(path, (gltf) => {
        if (currentModel) scene.remove(currentModel)
        mixer        = null
        currentModel = gltf.scene
        scene.add(currentModel)
        placeModel(currentModel)
        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(currentModel)
          mixer.clipAction(gltf.animations[0]).play()
        }
      })
    }

    // ── Environment loading ──────────────────────────────────────────────────
    function loadEnvironment(path, key, zoomOverride) {
      lastEnvPath = path
      lastEnvKey  = key
      if (zoomOverride != null) envZoom = zoomOverride

      const cfg = ENV_CONFIG[key] || ENV_CONFIG.room1

      loader.load(path, (gltf) => {
        if (environment) scene.remove(environment)
        environment = gltf.scene

        // 1. Measure raw env dimensions
        environment.scale.set(1, 1, 1)
        environment.position.set(0, 0, 0)
        environment.updateMatrixWorld(true)
        const b0   = new THREE.Box3().setFromObject(environment)
        const size = b0.getSize(new THREE.Vector3())
        const rawMax = Math.max(size.x, size.z)

        // 2. Target: longest axis = envZoom * MODEL_HEIGHT_M  (world units)
        //    This makes the env "envZoom model-heights" wide.
        const targetWorldSize = envZoom * MODEL_HEIGHT_M
        const envScale        = targetWorldSize / rawMax
        environment.scale.setScalar(envScale)
        environment.updateMatrixWorld(true)

        // 3. Derive metreInUnits:
        //    The env is cfg.envRealMetres wide in reality → targetWorldSize units
        metreInUnits = targetWorldSize / cfg.envRealMetres

        // 4. Centre env (XZ), lift floor to y=0
        const sb = new THREE.Box3().setFromObject(environment)
        const sc = sb.getCenter(new THREE.Vector3())
        environment.position.set(-sc.x, -sb.min.y, -sc.z)
        environment.updateMatrixWorld(true)

        fallbackFloor.visible = false
        scene.add(environment)
        environment.updateMatrixWorld(true)

        // 5. Compute world-space positions from metre config
        const M = metreInUnits
        camWorldPos.set(cfg.camPos.x * M, 0, cfg.camPos.z * M)
        tgtWorldPos.set(cfg.tgtPos.x * M, 0, cfg.tgtPos.z * M)
        modelWorldPos.set(cfg.modelPos.x * M, 0, cfg.modelPos.z * M)
        modelRotY = cfg.modelRotY ?? 0

        // 6. Place camera & model
        placeCamera()
        if (currentModel) placeModel(currentModel)
      })
    }

    // ── VR ───────────────────────────────────────────────────────────────────
    renderer.xr.addEventListener('sessionstart', () => {
      setTimeout(() => {
        const xrCam = renderer.xr.getCamera()
        xrCam.updateMatrixWorld(true)
        const xrPos = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld)

        playerRig.position.x += camWorldPos.x - xrPos.x
        playerRig.position.y += camWorldPos.y - xrPos.y
        playerRig.position.z += camWorldPos.z - xrPos.z

        const desired = new THREE.Vector3(
          tgtWorldPos.x - camWorldPos.x, 0,
          tgtWorldPos.z - camWorldPos.z
        ).normalize()
        const headDir = new THREE.Vector3()
        xrCam.getWorldDirection(headDir)
        headDir.y = 0; headDir.normalize()
        playerRig.rotation.y =
          Math.atan2(desired.x, desired.z) - Math.atan2(headDir.x, headDir.z)
      }, 100)
    })

    renderer.xr.addEventListener('sessionend', () => {
      playerRig.position.set(0, 0, 0)
      playerRig.rotation.set(0, 0, 0)
      placeCamera()
    })

    // ── Controllers ──────────────────────────────────────────────────────────
    const factory = new XRControllerModelFactory()
    const ctrl0   = renderer.xr.getController(0)
    const ctrl1   = renderer.xr.getController(1)
    playerRig.add(ctrl0, ctrl1)
    const grip0 = renderer.xr.getControllerGrip(0)
    const grip1 = renderer.xr.getControllerGrip(1)
    grip0.add(factory.createControllerModel(grip0))
    grip1.add(factory.createControllerModel(grip1))
    playerRig.add(grip0, grip1)

    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -(MODEL_HEIGHT_M * 8)),
    ])
    const rayMat = new THREE.LineBasicMaterial({ color: 0x00ffff })
    ctrl0.add(new THREE.Line(rayGeo, rayMat))
    ctrl1.add(new THREE.Line(rayGeo.clone(), rayMat.clone()))

    // ── Teleport ─────────────────────────────────────────────────────────────
    const raycaster  = new THREE.Raycaster()
    const tempMatrix = new THREE.Matrix4()

    function teleport(ctrl) {
      tempMatrix.identity().extractRotation(ctrl.matrixWorld)
      raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld)
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix)
      const objs = environment ? [fallbackFloor, environment] : [fallbackFloor]
      const hits = raycaster.intersectObjects(objs, true)
      if (!hits.length) return
      const hit  = hits[0].point
      const head = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld)
      playerRig.position.x = hit.x - (head.x - playerRig.position.x)
      playerRig.position.z = hit.z - (head.z - playerRig.position.z)
    }

    // ── Joystick locomotion ──────────────────────────────────────────────────
    //   Quest/Index: axes[2]=stickX, axes[3]=stickY
    //   Vive:        axes[0]=padX,   axes[1]=padY
    //
    //   axes[3] < 0  →  stick UP    →  move FORWARD
    //   axes[3] > 0  →  stick DOWN  →  move BACKWARD
    //   axes[2] > 0  →  stick RIGHT →  move RIGHT
    //   axes[2] < 0  →  stick LEFT  →  move LEFT
    const WALK_SPEED_MS = 1.4   // m/s
    const DEAD          = 0.15
    const prevBtns      = { 0: [], 1: [] }

    function handleXRMovement(delta) {
      const xrSession = renderer.xr.getSession()
      if (!xrSession) return

      const xrCam = renderer.xr.getCamera()
      xrCam.updateMatrixWorld(true)

      const fwd = new THREE.Vector3()
      xrCam.getWorldDirection(fwd)
      fwd.y = 0; fwd.normalize()

      const right = new THREE.Vector3()
      right.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()

      const spd = WALK_SPEED_MS * metreInUnits * delta

      xrSession.inputSources.forEach((src) => {
        const gp = src.gamepad
        if (!gp) return
        const idx  = src.handedness === 'left' ? 0 : 1
        const prev = prevBtns[idx] || []
        const curr = Array.from(gp.buttons).map(b => ({ pressed: b.pressed }))
        const ax   = gp.axes

        let sx = 0, sy = 0
        if (ax.length >= 4) {
          if (Math.abs(ax[2]) > DEAD) sx = ax[2]
          if (Math.abs(ax[3]) > DEAD) sy = ax[3]
        }
        if (sx === 0 && sy === 0 && ax.length >= 2) {
          if (Math.abs(ax[0]) > DEAD) sx = ax[0]
          if (Math.abs(ax[1]) > DEAD) sy = ax[1]
        }

        if (sx !== 0 || sy !== 0) {
          playerRig.position.addScaledVector(fwd,   -sy * spd)
          playerRig.position.addScaledVector(right,  sx * spd)
        }

        if (curr[0]?.pressed && !prev[0]?.pressed) {
          teleport(idx === 0 ? ctrl0 : ctrl1)
        }
        prevBtns[idx] = curr
      })
    }

    // ── Enter VR ─────────────────────────────────────────────────────────────
    window.enterVR = async () => {
      if (!navigator.xr) { alert('WebXR not supported'); return }
      try {
        const s = await navigator.xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
        })
        renderer.xr.setSession(s)
      } catch (e) { alert('VR error: ' + e.message) }
    }

    // ── Resize ───────────────────────────────────────────────────────────────
    function resize() {
      const { width: w, height: h } = container.getBoundingClientRect()
      if (!w || !h) return
      renderer.setSize(Math.floor(w), Math.floor(h), false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    // ── Loop ─────────────────────────────────────────────────────────────────
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta()
      if (mixer) mixer.update(delta)
      if (renderer.xr.isPresenting) handleXRMovement(delta)
      else controls.update()
      renderer.render(scene, camera)
    })

    // ── Expose to UI ─────────────────────────────────────────────────────────
    window.loadAvatar     = (p, k) => { loadModel(p); setActiveModel(k) }
    window.loadEnv        = (p, k) => { loadEnvironment(p, k); setActiveEnv(k) }
    window.updateEnvScale = (v)    => loadEnvironment(lastEnvPath, lastEnvKey, v)

    // ── Boot ─────────────────────────────────────────────────────────────────
    loadModel('/models/avatar.glb')
    loadEnvironment('/env/room1.glb', 'room1')

    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(container)
    window.addEventListener('resize', resize)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', resize)
      renderer.setAnimationLoop(null)
      renderer.dispose()
    }
  }, [])

  return (
    <div className="app">
      <div className="viewer"><div ref={mountRef} className="canvas" /></div>
      <div className="sidebar">
        <h3>Models:</h3>
        {[
          ['default', '/models/avatar.glb',  'Mặc định'],
          ['a1',      '/models/avatar1.glb', 'Người đàn ông đang đợi'],
          ['a2',      '/models/avatar2.glb', 'Cô gái đang chụp ảnh'],
          ['a3',      '/models/avatar3.glb', 'Bé gái đứng 1 mình'],
          ['a4',      '/models/avatar4.glb', 'Chàng trai đang nhảy'],
        ].map(([key, path, label]) => (
          <button key={key} className={activeModel === key ? 'active' : ''}
            onClick={() => window.loadAvatar(path, key)}>{label}</button>
        ))}
        <hr />
        <h3>Backgrounds:</h3>
        {[
          ['room1', '/env/room1.glb', 'Trong nhà'],
          ['room2', '/env/room2.glb', 'Núi đá'],
          ['room3', '/env/room3.glb', 'Công viên'],
        ].map(([key, path, label]) => (
          <button key={key} className={activeEnv === key ? 'active' : ''}
            onClick={() => window.loadEnv(path, key)}>{label}</button>
        ))}
        <hr />
        <h4>Zoom x{envScaleUI}</h4>
        <input type="range" min="5" max="100" value={envScaleUI}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setEnvScaleUI(v)
            window.updateEnvScale(v)
          }} />
        <hr />
        <button className="vr-btn" onClick={() => window.enterVR()}>Enter VR</button>
      </div>
    </div>
  )
}
