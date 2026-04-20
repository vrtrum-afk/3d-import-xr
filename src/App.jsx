import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory'
import './App.css'

const ENV_CONFIG = {
  room3: {
    envScale: 45, centerOffset: { x: 0, z: 0 },
    camX: 0, camZ: 2, tgtX: 0, tgtZ: -2,
    modelX: 0, modelZ: -3, modelRotY: 0,
    modelHeight: 1.7, eyeHeight: 1.6,
  },
  room2: {
    envScale: 25, centerOffset: { x: 0, z: 0 },
    camX: 0, camZ: 2, tgtX: 0, tgtZ: -2,
    modelX: 0, modelZ: 0, modelRotY: 0,
    modelHeight: 1.7, eyeHeight: 1.6,
  },
  room1: {
    envScale: 45, centerOffset: { x: -15, y: -5, z: 0 },
    camX: -13, camZ: 0, tgtX: -25, tgtZ: 0,
    modelX: -35, modelZ: 0, modelRotY: 14.2,
    modelHeight: 1.7, eyeHeight: 1.6,
  },
}

export default function App() {
  const mountRef = useRef(null)
  const [activeModel, setActiveModel] = useState('default')
  const [activeEnv,   setActiveEnv]   = useState('room1')
  const [envScaleUI,  setEnvScaleUI]  = useState(45)

  useEffect(() => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0d0d)
    const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 2000)

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

    const grid  = new THREE.GridHelper(20, 20)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x0d0d0d })
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(grid, floor)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping      = true
    controls.dampingFactor      = 0.08
    controls.screenSpacePanning = true

    const playerRig = new THREE.Group()
    scene.add(playerRig)
    playerRig.add(camera)

    let mixer        = null
    let currentModel = null
    let environment  = null
    let currentEnvKey = 'room1'
    let envZoom       = 45
    let lastEnvPath   = '/env/room1.glb'
    let activeCfg     = null

    const loader = new GLTFLoader()
    const clock  = new THREE.Clock()

    function getFloorY(x, z) {
      const rc = new THREE.Raycaster()
      rc.ray.origin.set(x, 10000, z)
      rc.ray.direction.set(0, -1, 0)
      const targets = []
      if (environment) targets.push(environment)
      if (floor.visible) targets.push(floor)
      const hits = rc.intersectObjects(targets, true)
      return hits.length ? hits[0].point.y : 0
    }

    // ─────────────────────────────────────────────────
    //  setCameraEyeLevel
    //  Gọi SAU KHI model đã được scale & đặt vị trí xong.
    //  Đọc chiều cao thực tế của model trong world space,
    //  rồi tính unitScale = scaledH / modelHeight (mét).
    //  Camera Y = floorY + eyeHeight * unitScale
    // ─────────────────────────────────────────────────
    function setCameraEyeLevel(model, cfg) {
      // Chiều cao thực tế của model sau khi scale
      const bbox = new THREE.Box3().setFromObject(model)
      const scaledH = bbox.getSize(new THREE.Vector3()).y

      // 1 mét thực = bao nhiêu world units
      const unitScale = scaledH / cfg.modelHeight

      const floorAtCam = getFloorY(cfg.camX, cfg.camZ)
      const floorAtTgt = getFloorY(cfg.tgtX, cfg.tgtZ)

      // Camera đặt ở tầm mắt người đứng tại vị trí camX, camZ
      const camY = floorAtCam + cfg.eyeHeight * unitScale
      // Target nhìn vào mặt model (0.9 * eyeHeight = ngang mắt)
      const tgtY = floorAtTgt + cfg.eyeHeight * 0.9 * unitScale

      camera.position.set(cfg.camX, camY, cfg.camZ)
      controls.target.set(cfg.tgtX, tgtY, cfg.tgtZ)
      controls.update()

      // Lưu lại để VR session dùng
      cfg.cameraPos    = { x: cfg.camX, y: camY, z: cfg.camZ }
      cfg.cameraTarget = { x: cfg.tgtX, y: tgtY, z: cfg.tgtZ }
    }

    function placeModel(model, cfg) {
      // 1. Reset
      model.scale.set(1, 1, 1)
      model.position.set(0, 0, 0)
      model.rotation.y = cfg.modelRotY ?? 0
      model.updateMatrixWorld(true)

      // 2. Chiều cao gốc (chưa scale)
      const b0   = new THREE.Box3().setFromObject(model)
      const rawH = b0.getSize(new THREE.Vector3()).y

      // 3. Scale model sao cho chiều cao = modelHeight world-units
      //    Dùng khoảng cách cam↔model làm reference scale
      const dx   = cfg.camX - cfg.modelX
      const dz   = cfg.camZ - cfg.modelZ
      const dist = Math.sqrt(dx * dx + dz * dz)
      //    Tỉ lệ: người cao 1.7m, khoảng cách nhìn tự nhiên ~10m → 0.17
      //    room1: dist≈22, worldH = 22*0.17 ≈ 3.7 units (hợp lý với env scale 45)
      const worldModelH = dist * (cfg.modelHeight / 10.0)
      const s = worldModelH / rawH
      model.scale.set(s, s, s)

      // 4. Đặt X, Z
      model.position.x = cfg.modelX
      model.position.z = cfg.modelZ
      model.position.y = 0
      model.updateMatrixWorld(true)

      // 5. Căn chân chạm sàn
      const b1 = new THREE.Box3().setFromObject(model)
      const floorAtModel = getFloorY(cfg.modelX, cfg.modelZ)
      model.position.y = floorAtModel - b1.min.y
      model.updateMatrixWorld(true)

      // 6. Tính camera Y từ chiều cao model thực tế
      setCameraEyeLevel(model, cfg)
    }

    function loadModel(path) {
      loader.load(path, (gltf) => {
        if (currentModel) scene.remove(currentModel)
        currentModel = gltf.scene
        scene.add(currentModel)
        if (activeCfg) placeModel(currentModel, activeCfg)
        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(currentModel)
          mixer.clipAction(gltf.animations[0]).play()
        }
      })
    }

    function applyEnvConfig(cfg) {
      activeCfg = cfg
      playerRig.position.set(0, 0, 0)
      playerRig.rotation.set(0, 0, 0)
      // Camera tạm — placeModel sẽ override với eyeLevel đúng
      const floorAtCam = getFloorY(cfg.camX, cfg.camZ)
      camera.position.set(cfg.camX, floorAtCam + cfg.eyeHeight, cfg.camZ)
      controls.target.set(cfg.tgtX, floorAtCam + cfg.eyeHeight * 0.9, cfg.tgtZ)
      controls.update()
      if (currentModel) placeModel(currentModel, cfg)
    }

    function loadEnvironment(path, key) {
      lastEnvPath   = path
      currentEnvKey = key
      const baseCfg = { ...(ENV_CONFIG[key] || ENV_CONFIG.room1) }
      if (baseCfg.envScale != null) envZoom = baseCfg.envScale

      loader.load(path, (gltf) => {
        if (environment) scene.remove(environment)
        environment   = gltf.scene
        floor.visible = false
        grid.visible  = false

        // Scale env
        const b    = new THREE.Box3().setFromObject(environment)
        const size = b.getSize(new THREE.Vector3())
        environment.scale.setScalar((2 * envZoom) / Math.max(size.x, size.z))
        environment.updateMatrixWorld(true)

        // Căn giữa env
        const sb = new THREE.Box3().setFromObject(environment)
        const sc = sb.getCenter(new THREE.Vector3())
        environment.position.set(
          -sc.x + (baseCfg.centerOffset?.x ?? 0),
          -sb.min.y,
          -sc.z + (baseCfg.centerOffset?.z ?? 0)
        )
        scene.add(environment)
        environment.updateMatrixWorld(true)

        // Kéo sàn về y=0 tại vị trí camera
        const rc = new THREE.Raycaster()
        rc.ray.origin.set(baseCfg.camX, 10000, baseCfg.camZ)
        rc.ray.direction.set(0, -1, 0)
        const hits = rc.intersectObject(environment, true)
        if (hits.length) {
          environment.position.y -= hits[0].point.y
          environment.updateMatrixWorld(true)
        }

        applyEnvConfig(baseCfg)
      })
    }

    function updateEnvScale(v) {
      envZoom = v
      if (environment) loadEnvironment(lastEnvPath, currentEnvKey)
    }

    // ─────────────────────────────────────────────────
    //  VR
    // ─────────────────────────────────────────────────
    renderer.xr.addEventListener('sessionstart', () => {
      setTimeout(() => {
        if (!activeCfg?.cameraPos) return
        const xrCam = renderer.xr.getCamera()
        xrCam.updateMatrixWorld(true)
        const xrPos = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld)
        playerRig.position.x += activeCfg.cameraPos.x - xrPos.x
        playerRig.position.y += activeCfg.cameraPos.y - xrPos.y
        playerRig.position.z += activeCfg.cameraPos.z - xrPos.z
        const desired = new THREE.Vector3(
          activeCfg.cameraTarget.x - activeCfg.cameraPos.x, 0,
          activeCfg.cameraTarget.z - activeCfg.cameraPos.z
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
      if (!activeCfg?.cameraPos) return
      camera.position.set(activeCfg.cameraPos.x, activeCfg.cameraPos.y, activeCfg.cameraPos.z)
      controls.target.set(activeCfg.cameraTarget.x, activeCfg.cameraTarget.y, activeCfg.cameraTarget.z)
      controls.update()
    })

    // ─────────────────────────────────────────────────
    //  Controllers
    // ─────────────────────────────────────────────────
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
      new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-8)
    ])
    const rayMat = new THREE.LineBasicMaterial({ color: 0x00ffff })
    ctrl0.add(new THREE.Line(rayGeo, rayMat))
    ctrl1.add(new THREE.Line(rayGeo.clone(), rayMat.clone()))

    const raycaster  = new THREE.Raycaster()
    const tempMatrix = new THREE.Matrix4()

    function teleport(ctrl) {
      tempMatrix.identity().extractRotation(ctrl.matrixWorld)
      raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld)
      raycaster.ray.direction.set(0,0,-1).applyMatrix4(tempMatrix)
      const objs = environment ? [floor, environment] : [floor]
      const hits = raycaster.intersectObjects(objs, true)
      if (!hits.length) return
      const hit  = hits[0].point
      const head = new THREE.Vector3().setFromMatrixPosition(renderer.xr.getCamera().matrixWorld)
      playerRig.position.x = hit.x - (head.x - playerRig.position.x)
      playerRig.position.z = hit.z - (head.z - playerRig.position.z)
    }

    // ─────────────────────────────────────────────────
    //  Joystick movement — FIXED
    //  axes[2]=thumbstick X (Quest), axes[3]=thumbstick Y
    //  sy < 0 → tiến, sy > 0 → lùi
    //  sx < 0 → trái, sx > 0 → phải
    // ─────────────────────────────────────────────────
    const prevBtn = { 0: [], 1: [] }

    function handleXRMovement(delta) {
      const session = renderer.xr.getSession()
      if (!session) return

      const xrCam = renderer.xr.getCamera()
      xrCam.updateMatrixWorld(true)

      const camDir = new THREE.Vector3()
      xrCam.getWorldDirection(camDir)
      camDir.y = 0
      camDir.normalize()

      // forward = hướng camera nhìn (XZ)
      const forward = camDir.clone()
      // right = cross(up, forward) = (fz, 0, -fx) ✓
      const up    = new THREE.Vector3(0, 1, 0)
      const right = new THREE.Vector3().crossVectors(up, forward).normalize()

      session.inputSources.forEach((src) => {
        const gp = src.gamepad
        if (!gp) return
        const idx  = src.handedness === 'left' ? 0 : 1
        const prev = prevBtn[idx] || []
        const curr = Array.from(gp.buttons).map(b => ({ pressed: b.pressed }))

        const ax   = gp.axes
        const DEAD = 0.15
        let sx = 0, sy = 0

        // Quest/Index: thumbstick = axes[2], axes[3]
        if (ax.length >= 4) {
          if (Math.abs(ax[2]) > DEAD) sx = ax[2]
          if (Math.abs(ax[3]) > DEAD) sy = ax[3]
        }
        // Vive fallback: axes[0], axes[1]
        if (sx === 0 && sy === 0 && ax.length >= 2) {
          if (Math.abs(ax[0]) > DEAD) sx = ax[0]
          if (Math.abs(ax[1]) > DEAD) sy = ax[1]
        }

        if (sx !== 0 || sy !== 0) {
          const spd = 3 * delta
          playerRig.position.addScaledVector(forward, -sy * spd) // sy<0=up=tiến
          playerRig.position.addScaledVector(right,    sx * spd) // sx>0=right=phải
        }

        if (curr[0]?.pressed && !prev[0]?.pressed) {
          teleport(idx === 0 ? ctrl0 : ctrl1)
        }
        prevBtn[idx] = curr
      })
    }

    // ─────────────────────────────────────────────────
    //  Enter VR / Resize / Loop
    // ─────────────────────────────────────────────────
    window.enterVR = async () => {
      if (!navigator.xr) { alert('WebXR not supported'); return }
      try {
        const s = await navigator.xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
        })
        renderer.xr.setSession(s)
      } catch (e) { alert('VR error: ' + e.message) }
    }

    function resize() {
      const { width: w, height: h } = container.getBoundingClientRect()
      if (!w || !h) return
      renderer.setSize(Math.floor(w), Math.floor(h), false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta()
      if (mixer) mixer.update(delta)
      if (renderer.xr.isPresenting) handleXRMovement(delta)
      else controls.update()
      renderer.render(scene, camera)
    })

    loadModel('/models/avatar.glb')
    loadEnvironment('/env/room1.glb', 'room1')

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