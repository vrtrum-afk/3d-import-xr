import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory'
import './App.css'

// ─── Constants ───────────────────────────────────────────────────────────────
const MODEL_HEIGHT = 170   // world units = 170 cm
const EYE_HEIGHT   = 160   // camera Y above floor

// ─── Env configs ─────────────────────────────────────────────────────────────
// All X/Z values are in "model-height multiples" → multiplied by MODEL_HEIGHT at runtime
// envScale = how many model-heights wide the environment should be
const ENV_CONFIG = {
  room1: {
    envScale: 45,
    centerOffset: { x: -15, z: 0 },
    camX: -13, camZ: 0,
    tgtX: -25, tgtZ: 0,
    modelX: -35, modelZ: 0, modelRotY: 14.2,
  },
  room2: {
    envScale: 45,
    centerOffset: { x: 0, z: 0 },
    camX: 0, camZ: 2,
    tgtX: 0, tgtZ: -2,
    modelX: 0, modelZ: -3, modelRotY: 0,
  },
  room3: {
    envScale: 45,
    centerOffset: { x: 0, z: 0 },
    camX: 0, camZ: 2,
    tgtX: 0, tgtZ: -2,
    modelX: 0, modelZ: -3, modelRotY: 0,
  },
}

export default function App() {
  const mountRef = useRef(null)
  const [activeModel, setActiveModel] = useState('default')
  const [activeEnv,   setActiveEnv]   = useState('room1')
  const [envScaleUI,  setEnvScaleUI]  = useState(45)

  useEffect(() => {
    // ─── Scene setup ───────────────────────────────────────────────────────
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0d0d)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100000)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.xr.enabled = true
    renderer.xr.setReferenceSpaceType('local-floor')

    const container = mountRef.current
    container.innerHTML = ''
    container.appendChild(renderer.domElement)
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%'

    // ─── Lights ────────────────────────────────────────────────────────────
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2))
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))

    // ─── Fallback floor & grid ─────────────────────────────────────────────
    const grid = new THREE.GridHelper(MODEL_HEIGHT * 20, 20)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(MODEL_HEIGHT * 200, MODEL_HEIGHT * 200),
      new THREE.MeshStandardMaterial({ color: 0x0d0d0d })
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = 0
    scene.add(grid, floor)

    // ─── Controls ──────────────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping      = true
    controls.dampingFactor      = 0.08
    controls.screenSpacePanning = true

    // ─── Player rig (VR) ───────────────────────────────────────────────────
    const playerRig = new THREE.Group()
    scene.add(playerRig)
    playerRig.add(camera)

    // ─── State refs ────────────────────────────────────────────────────────
    let mixer        = null
    let currentModel = null
    let environment  = null
    let currentEnvKey = 'room1'
    let envZoom       = 45
    let lastEnvPath   = '/env/room1.glb'
    let activeCfg     = null   // resolved cfg (X/Z already in world units)

    const loader = new GLTFLoader()
    const clock  = new THREE.Clock()

    // ─────────────────────────────────────────────────────────────────────
    // getFloorY — raycast down to find floor surface at (x, z)
    // ─────────────────────────────────────────────────────────────────────
    function getFloorY(x, z) {
      const rc = new THREE.Raycaster()
      rc.ray.origin.set(x, 1e6, z)
      rc.ray.direction.set(0, -1, 0)
      const targets = []
      if (environment) targets.push(environment)
      targets.push(floor)
      const hits = rc.intersectObjects(targets, true)
      return hits.length ? hits[0].point.y : 0
    }

    // ─────────────────────────────────────────────────────────────────────
    // resolveCfg — convert multiplier-based config → world-unit config
    // ─────────────────────────────────────────────────────────────────────
    function resolveCfg(raw) {
      const M = MODEL_HEIGHT
      return {
        ...raw,
        camX:   raw.camX   * M,
        camZ:   raw.camZ   * M,
        tgtX:   raw.tgtX   * M,
        tgtZ:   raw.tgtZ   * M,
        modelX: raw.modelX * M,
        modelZ: raw.modelZ * M,
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // placeModel
    //   • Scale model so its height = MODEL_HEIGHT world units (170 cm)
    //   • Snap feet exactly to floor surface (no sinking)
    //   • Set camera at EYE_HEIGHT above floor, looking straight at model face
    // ─────────────────────────────────────────────────────────────────────
    function placeModel(model, cfg) {
      // 1. Reset transforms
      model.scale.set(1, 1, 1)
      model.position.set(0, 0, 0)
      model.rotation.set(0, cfg.modelRotY ?? 0, 0)
      model.updateMatrixWorld(true)

      // 2. Measure raw height
      const b0   = new THREE.Box3().setFromObject(model)
      const rawH = b0.getSize(new THREE.Vector3()).y
      if (rawH === 0) return

      // 3. Scale so height = MODEL_HEIGHT
      const s = MODEL_HEIGHT / rawH
      model.scale.set(s, s, s)
      model.updateMatrixWorld(true)

      // 4. Set X/Z position
      model.position.x = cfg.modelX
      model.position.z = cfg.modelZ
      model.position.y = 0
      model.updateMatrixWorld(true)

      // 5. Snap feet to floor — use bounding box AFTER scale & position
      const b1     = new THREE.Box3().setFromObject(model)
      const floorY = getFloorY(cfg.modelX, cfg.modelZ)
      // b1.min.y is where the feet are in world space; push model up so feet = floorY
      model.position.y += floorY - b1.min.y
      model.updateMatrixWorld(true)

      // 6. Camera: fixed EYE_HEIGHT above cam floor, looking straight ahead (same Y)
      const floorCam = getFloorY(cfg.camX, cfg.camZ)
      const camY     = floorCam + EYE_HEIGHT
      const tgtY     = camY   // perfectly horizontal gaze → no bird-view

      camera.position.set(cfg.camX, camY, cfg.camZ)
      controls.target.set(cfg.tgtX, tgtY, cfg.tgtZ)
      controls.update()

      // Save for VR session
      cfg.cameraPos    = { x: cfg.camX,  y: camY, z: cfg.camZ }
      cfg.cameraTarget = { x: cfg.tgtX,  y: tgtY, z: cfg.tgtZ }
    }

    // ─────────────────────────────────────────────────────────────────────
    // loadModel
    // ─────────────────────────────────────────────────────────────────────
    function loadModel(path) {
      loader.load(path, (gltf) => {
        if (currentModel) scene.remove(currentModel)
        mixer        = null
        currentModel = gltf.scene
        scene.add(currentModel)
        if (activeCfg) placeModel(currentModel, activeCfg)
        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(currentModel)
          mixer.clipAction(gltf.animations[0]).play()
        }
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    // applyEnvConfig — set camera/model after env is ready
    // ─────────────────────────────────────────────────────────────────────
    function applyEnvConfig(raw) {
      const cfg  = resolveCfg(raw)
      activeCfg  = cfg
      playerRig.position.set(0, 0, 0)
      playerRig.rotation.set(0, 0, 0)
      if (currentModel) placeModel(currentModel, cfg)
      else {
        // No model yet — just set camera roughly
        const floorCam = getFloorY(cfg.camX, cfg.camZ)
        const camY     = floorCam + EYE_HEIGHT
        camera.position.set(cfg.camX, camY, cfg.camZ)
        controls.target.set(cfg.tgtX, camY, cfg.tgtZ)
        controls.update()
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // loadEnvironment
    // ─────────────────────────────────────────────────────────────────────
    function loadEnvironment(path, key) {
      lastEnvPath   = path
      currentEnvKey = key
      const rawCfg  = ENV_CONFIG[key] || ENV_CONFIG.room1
      envZoom       = rawCfg.envScale ?? 45

      loader.load(path, (gltf) => {
        if (environment) scene.remove(environment)
        environment   = gltf.scene
        floor.visible = false
        grid.visible  = false

        // 1. Measure env in its raw space
        const b    = new THREE.Box3().setFromObject(environment)
        const size = b.getSize(new THREE.Vector3())

        // 2. Target width = envZoom * MODEL_HEIGHT  (env is envZoom model-heights wide)
        const targetWidth = envZoom * MODEL_HEIGHT
        const envScale    = targetWidth / Math.max(size.x, size.z)
        environment.scale.setScalar(envScale)
        environment.updateMatrixWorld(true)

        // 3. Center env, apply offset (offset is in model-height multiples → * MODEL_HEIGHT)
        const sb = new THREE.Box3().setFromObject(environment)
        const sc = sb.getCenter(new THREE.Vector3())
        environment.position.set(
          -sc.x + (rawCfg.centerOffset?.x ?? 0) * MODEL_HEIGHT,
          -sb.min.y,
          -sc.z + (rawCfg.centerOffset?.z ?? 0) * MODEL_HEIGHT,
        )
        environment.updateMatrixWorld(true)

        // 4. Align floor under camera position to y=0
        const camXW = rawCfg.camX * MODEL_HEIGHT
        const camZW = rawCfg.camZ * MODEL_HEIGHT
        const rc    = new THREE.Raycaster()
        rc.ray.origin.set(camXW, 1e6, camZW)
        rc.ray.direction.set(0, -1, 0)
        const hits = rc.intersectObject(environment, true)
        if (hits.length) {
          environment.position.y -= hits[0].point.y
          environment.updateMatrixWorld(true)
        }

        scene.add(environment)
        applyEnvConfig(rawCfg)
      })
    }

    function updateEnvScale(v) {
      envZoom = v
      loadEnvironment(lastEnvPath, currentEnvKey)
    }

    // ─────────────────────────────────────────────────────────────────────
    // VR session management
    // ─────────────────────────────────────────────────────────────────────
    renderer.xr.addEventListener('sessionstart', () => {
      setTimeout(() => {
        if (!activeCfg?.cameraPos) return
        const xrCam = renderer.xr.getCamera()
        xrCam.updateMatrixWorld(true)
        const xrPos = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld)

        // Offset rig so XR camera lands at desired position
        playerRig.position.x += activeCfg.cameraPos.x - xrPos.x
        playerRig.position.y += activeCfg.cameraPos.y - xrPos.y
        playerRig.position.z += activeCfg.cameraPos.z - xrPos.z

        // Rotate rig so user faces the model
        const desired = new THREE.Vector3(
          activeCfg.cameraTarget.x - activeCfg.cameraPos.x, 0,
          activeCfg.cameraTarget.z - activeCfg.cameraPos.z
        ).normalize()
        const headDir = new THREE.Vector3()
        xrCam.getWorldDirection(headDir)
        headDir.y = 0
        headDir.normalize()
        playerRig.rotation.y =
          Math.atan2(desired.x, desired.z) - Math.atan2(headDir.x, headDir.z)
      }, 100)
    })

    renderer.xr.addEventListener('sessionend', () => {
      playerRig.position.set(0, 0, 0)
      playerRig.rotation.set(0, 0, 0)
      if (!activeCfg?.cameraPos) return
      camera.position.set(activeCfg.cameraPos.x, activeCfg.cameraPos.y, activeCfg.cameraPos.z)
      controls.target.set(activeCfg.cameraTarget.x, activeCfg.cameraTarget.y, activeCfg.cameraTarget.z)
      controls.update()
    })

    // ─────────────────────────────────────────────────────────────────────
    // VR Controllers
    // ─────────────────────────────────────────────────────────────────────
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
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -8 * MODEL_HEIGHT)
    ])
    const rayMat = new THREE.LineBasicMaterial({ color: 0x00ffff })
    ctrl0.add(new THREE.Line(rayGeo, rayMat))
    ctrl1.add(new THREE.Line(rayGeo.clone(), rayMat.clone()))

    // ─────────────────────────────────────────────────────────────────────
    // Teleport
    // ─────────────────────────────────────────────────────────────────────
    const raycaster  = new THREE.Raycaster()
    const tempMatrix = new THREE.Matrix4()

    function teleport(ctrl) {
      tempMatrix.identity().extractRotation(ctrl.matrixWorld)
      raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld)
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix)
      const objs = environment ? [floor, environment] : [floor]
      const hits = raycaster.intersectObjects(objs, true)
      if (!hits.length) return
      const hit  = hits[0].point
      const head = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld)
      playerRig.position.x = hit.x - (head.x - playerRig.position.x)
      playerRig.position.z = hit.z - (head.z - playerRig.position.z)
    }

    // ─────────────────────────────────────────────────────────────────────
    // Joystick locomotion
    //
    //   Axes layout (Quest / Index):  axes[2] = thumbstick X,  axes[3] = Y
    //   Vive fallback:                axes[0] = X,             axes[1] = Y
    //
    //   axes[3] < 0  →  push stick UP    →  move FORWARD  (into screen)
    //   axes[3] > 0  →  push stick DOWN  →  move BACKWARD
    //   axes[2] < 0  →  push stick LEFT  →  move LEFT
    //   axes[2] > 0  →  push stick RIGHT →  move RIGHT
    //
    //   "forward" is defined by where the XR camera is looking (XZ plane only).
    //   "right"   is the perpendicular direction to the right.
    //
    //   Speed is proportional to MODEL_HEIGHT so movement feels natural
    //   regardless of world scale (≈ 3 m/s walking speed at 170 cm scale).
    // ─────────────────────────────────────────────────────────────────────
    const MOVE_SPEED = MODEL_HEIGHT * 3   // world-units per second  (~3 m/s)
    const DEAD_ZONE  = 0.15
    const prevButtons = { 0: [], 1: [] }

    function handleXRMovement(delta) {
      const session = renderer.xr.getSession()
      if (!session) return

      const xrCam = renderer.xr.getCamera()
      xrCam.updateMatrixWorld(true)

      // Flat forward direction (XZ) from camera
      const forward = new THREE.Vector3()
      xrCam.getWorldDirection(forward)
      forward.y = 0
      forward.normalize()

      // Right = cross(forward, up)  →  positive X side
      const right = new THREE.Vector3()
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()

      session.inputSources.forEach((src) => {
        const gp = src.gamepad
        if (!gp) return
        const idx  = src.handedness === 'left' ? 0 : 1
        const prev = prevButtons[idx] || []
        const curr = Array.from(gp.buttons).map(b => ({ pressed: b.pressed }))
        const ax   = gp.axes

        let sx = 0, sy = 0

        // Quest / Index thumbstick
        if (ax.length >= 4) {
          if (Math.abs(ax[2]) > DEAD_ZONE) sx = ax[2]
          if (Math.abs(ax[3]) > DEAD_ZONE) sy = ax[3]
        }
        // Vive trackpad fallback
        if (sx === 0 && sy === 0 && ax.length >= 2) {
          if (Math.abs(ax[0]) > DEAD_ZONE) sx = ax[0]
          if (Math.abs(ax[1]) > DEAD_ZONE) sy = ax[1]
        }

        if (sx !== 0 || sy !== 0) {
          const spd = MOVE_SPEED * delta
          // sy < 0 (stick up)   → move forward  → addScaledVector(forward, +spd)
          // sy > 0 (stick down) → move backward → addScaledVector(forward, -spd)
          playerRig.position.addScaledVector(forward, -sy * spd)
          // sx > 0 (stick right) → move right → addScaledVector(right, +spd)
          // sx < 0 (stick left)  → move left  → addScaledVector(right, -spd)
          playerRig.position.addScaledVector(right, sx * spd)
        }

        // Button 0 (trigger / primary) → teleport
        if (curr[0]?.pressed && !prev[0]?.pressed) {
          teleport(idx === 0 ? ctrl0 : ctrl1)
        }

        prevButtons[idx] = curr
      })
    }

    // ─────────────────────────────────────────────────────────────────────
    // Enter VR
    // ─────────────────────────────────────────────────────────────────────
    window.enterVR = async () => {
      if (!navigator.xr) { alert('WebXR not supported'); return }
      try {
        const s = await navigator.xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
        })
        renderer.xr.setSession(s)
      } catch (e) { alert('VR error: ' + e.message) }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Resize
    // ─────────────────────────────────────────────────────────────────────
    function resize() {
      const { width: w, height: h } = container.getBoundingClientRect()
      if (!w || !h) return
      renderer.setSize(Math.floor(w), Math.floor(h), false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    // ─────────────────────────────────────────────────────────────────────
    // Render loop
    // ─────────────────────────────────────────────────────────────────────
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta()
      if (mixer) mixer.update(delta)
      if (renderer.xr.isPresenting) handleXRMovement(delta)
      else controls.update()
      renderer.render(scene, camera)
    })

    // ─────────────────────────────────────────────────────────────────────
    // Initial load
    // ─────────────────────────────────────────────────────────────────────
    loadModel('/models/avatar.glb')
    loadEnvironment('/env/room1.glb', 'room1')

    // Expose to sidebar buttons
    window.loadAvatar     = (p, k) => { loadModel(p); setActiveModel(k) }
    window.loadEnv        = (p, k) => { loadEnvironment(p, k); setActiveEnv(k) }
    window.updateEnvScale = (v)    => updateEnvScale(v)

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

  // ─── UI ──────────────────────────────────────────────────────────────────
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
