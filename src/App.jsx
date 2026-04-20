import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory'
import './App.css'

// ─────────────────────────────────────────────
//  ENV CONFIG
//  cameraPos / cameraTarget: vị trí & hướng nhìn trên web preview
//  modelPos  : chân model đứng ở đây (y = mặt sàn thực)
//  modelHeight: null → tự tính; hoặc đặt số cụ thể (world units)
// ─────────────────────────────────────────────
const ENV_CONFIG = {
  room3: {
    envScale:     45,
    centerOffset: { x: 0, z: 0 },
    cameraPos:    { x: 0,   y: 1.6, z:  2   },
    cameraTarget: { x: 0,   y: 1.0, z: -2   },
    modelPos:     { x: 0,   y: 0,   z: -3   },
    modelRotY:    0,
    modelHeight:  1.7,
  },
  room2: {
    envScale:     25,
    centerOffset: { x: 0, z: 0 },
    cameraPos:    { x: 0,   y: 1.6, z:  2   },
    cameraTarget: { x: 0,   y: 1.0, z: -2   },
    modelPos:     { x: 0,   y: 0,   z:  0   },
    modelRotY:    0,
    modelHeight:  1.7,
  },
  room1: {
    envScale:     45,
    centerOffset: { x: -15, z: 0 },
    cameraPos:    { x: -13, y: -2.5, z: 0   },
    cameraTarget: { x: -25, y: -5,   z: 0   },
    modelPos:     { x: -35, y: -6,   z: 0   },
    modelRotY:    14.2,
    modelHeight:  null,
  },
}

export default function App() {
  const mountRef = useRef(null)
  const [activeModel, setActiveModel] = useState('default')
  const [activeEnv,   setActiveEnv]   = useState('room1')
  const [envScaleUI,  setEnvScaleUI]  = useState(45)

  useEffect(() => {
    // ── Scene ──────────────────────────────────
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

    // ── Lights ─────────────────────────────────
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2))
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))

    // ── Floor / grid (fallback khi chưa load env) ──
    const grid = new THREE.GridHelper(20, 20)
    scene.add(grid)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({ color: 0x0d0d0d })
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)

    // ── OrbitControls (web preview) ────────────
    // Đây là behavior Sketchfab:
    //   • Chuột trái / 1 ngón  → xoay quanh target
    //   • Chuột phải / 2 ngón  → pan
    //   • Scroll               → zoom
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping    = true
    controls.dampingFactor    = 0.08
    controls.screenSpacePanning = true   // pan theo màn hình, không theo trục Y

    // ── playerRig (VR only) ────────────────────
    const playerRig = new THREE.Group()
    scene.add(playerRig)
    playerRig.add(camera)   // camera là child; trên web OrbitControls move camera trực tiếp

    // ── State ──────────────────────────────────
    let mixer         = null
    let currentModel  = null
    let environment   = null
    let currentEnvKey = 'room1'
    let envZoom       = 45
    let lastEnvPath   = '/env/room1.glb'
    let activeCfg     = ENV_CONFIG['room1']
    // floor Y tại vị trí camera (tính sau raycast, dùng cho VR height)
    let floorY        = 0

    const loader = new GLTFLoader()
    const clock  = new THREE.Clock()

    // ══════════════════════════════════════════
    //  MODEL
    // ══════════════════════════════════════════
    function calcModelHeight(cfg) {
      if (cfg.modelHeight != null) return cfg.modelHeight
      const dx   = cfg.cameraPos.x - cfg.modelPos.x
      const dz   = cfg.cameraPos.z - cfg.modelPos.z
      return Math.sqrt(dx * dx + dz * dz) * 0.1
    }

    function placeModel(model, cfg) {
      // 1. Scale
      const b0 = new THREE.Box3().setFromObject(model)
      model.scale.setScalar(calcModelHeight(cfg) / b0.getSize(new THREE.Vector3()).y)

      // 2. Rotation
      model.rotation.y = cfg.modelRotY ?? 0

      // 3. Tạm đặt position
      model.position.set(cfg.modelPos.x, cfg.modelPos.y, cfg.modelPos.z)

      // 4. Cập nhật world matrix VỚI position hiện tại
      model.updateMatrixWorld(true)

      // 5. Tính bbox thực tế
      const b1 = new THREE.Box3().setFromObject(model)

      // 6. Đẩy model lên sao cho min.y == cfg.modelPos.y  (chân chạm sàn)
      //    footOffset = khoảng chân đang bị chìm (âm = chìm, dương = nổi)
      const footOffset = b1.min.y - cfg.modelPos.y
      model.position.y = cfg.modelPos.y - footOffset

      // 7. updateMatrixWorld lần cuối để scene tree nhất quán
      model.updateMatrixWorld(true)
    }

    function loadModel(path) {
      loader.load(path, (gltf) => {
        if (currentModel) scene.remove(currentModel)
        currentModel = gltf.scene
        scene.add(currentModel)
        placeModel(currentModel, ENV_CONFIG[currentEnvKey] || ENV_CONFIG.room1)
        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(currentModel)
          mixer.clipAction(gltf.animations[0]).play()
        }
      })
    }

    // ══════════════════════════════════════════
    //  ENVIRONMENT
    // ══════════════════════════════════════════
    function applyEnvConfig(cfg) {
      activeCfg = cfg
      // Web preview: đặt camera + target cho OrbitControls
      playerRig.position.set(0, 0, 0)
      playerRig.rotation.set(0, 0, 0)
      camera.position.set(cfg.cameraPos.x, cfg.cameraPos.y, cfg.cameraPos.z)
      controls.target.set(cfg.cameraTarget.x, cfg.cameraTarget.y, cfg.cameraTarget.z)
      controls.update()
      if (currentModel) placeModel(currentModel, cfg)
    }

    function loadEnvironment(path, key) {
      lastEnvPath   = path
      currentEnvKey = key
      const cfg = ENV_CONFIG[key] || ENV_CONFIG.room1
      if (cfg.envScale != null) envZoom = cfg.envScale

      loader.load(path, (gltf) => {
        if (environment) scene.remove(environment)
        environment  = gltf.scene
        floor.visible = false
        grid.visible  = false

        // Scale env
        const b    = new THREE.Box3().setFromObject(environment)
        const size = b.getSize(new THREE.Vector3())
        environment.scale.setScalar((2 * envZoom) / Math.max(size.x, size.z))

        // Căn giữa
        environment.updateMatrixWorld(true)
        const sb  = new THREE.Box3().setFromObject(environment)
        const sc  = sb.getCenter(new THREE.Vector3())
        environment.position.set(
          -sc.x + (cfg.centerOffset?.x ?? 0),
          -sb.min.y,
          -sc.z + (cfg.centerOffset?.z ?? 0)
        )
        scene.add(environment)
        environment.updateMatrixWorld(true)

        // Raycast tìm sàn thực tế ngay dưới camera
        const rc = new THREE.Raycaster()
        rc.ray.origin.set(cfg.cameraPos.x, 1000, cfg.cameraPos.z)
        rc.ray.direction.set(0, -1, 0)
        const hits = rc.intersectObject(environment, true)
        if (hits.length) {
          environment.position.y -= hits[0].point.y   // kéo sàn về y=0
          environment.updateMatrixWorld(true)
          floorY = 0
        }

        applyEnvConfig(cfg)
      })
    }

    function updateEnvScale(v) {
      envZoom = v
      if (environment) loadEnvironment(lastEnvPath, currentEnvKey)
    }

    // ══════════════════════════════════════════
    //  VR – căn camera khi vào session
    // ══════════════════════════════════════════
    renderer.xr.addEventListener('sessionstart', () => {
      // Đợi 1 frame để XR camera có matrixWorld hợp lệ
      setTimeout(() => {
        const cfg    = activeCfg
        const xrCam  = renderer.xr.getCamera()
        xrCam.updateMatrixWorld(true)

        // ── Bù vị trí ──
        const xrPos = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld)
        playerRig.position.x += cfg.cameraPos.x - xrPos.x
        playerRig.position.y += cfg.cameraPos.y - xrPos.y
        playerRig.position.z += cfg.cameraPos.z - xrPos.z

        // ── Bù hướng nhìn (yaw only) ──
        const desired = new THREE.Vector3(
          cfg.cameraTarget.x - cfg.cameraPos.x, 0,
          cfg.cameraTarget.z - cfg.cameraPos.z
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
      const cfg = activeCfg
      camera.position.set(cfg.cameraPos.x, cfg.cameraPos.y, cfg.cameraPos.z)
      controls.target.set(cfg.cameraTarget.x, cfg.cameraTarget.y, cfg.cameraTarget.z)
      controls.update()
    })

    // ══════════════════════════════════════════
    //  CONTROLLERS
    // ══════════════════════════════════════════
    const factory     = new XRControllerModelFactory()
    const controller0 = renderer.xr.getController(0)
    const controller1 = renderer.xr.getController(1)
    playerRig.add(controller0, controller1)

    const grip0 = renderer.xr.getControllerGrip(0)
    const grip1 = renderer.xr.getControllerGrip(1)
    grip0.add(factory.createControllerModel(grip0))
    grip1.add(factory.createControllerModel(grip1))
    playerRig.add(grip0, grip1)

    const rayPts = [new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-8)]
    const rayGeo = new THREE.BufferGeometry().setFromPoints(rayPts)
    const rayMat = new THREE.LineBasicMaterial({ color: 0x00ffff })
    controller0.add(new THREE.Line(rayGeo,         rayMat))
    controller1.add(new THREE.Line(rayGeo.clone(), rayMat.clone()))

    // ── Teleport ──
    const raycaster  = new THREE.Raycaster()
    const tempMatrix = new THREE.Matrix4()

    function teleport(ctrl) {
      tempMatrix.identity().extractRotation(ctrl.matrixWorld)
      raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld)
      raycaster.ray.direction.set(0,0,-1).applyMatrix4(tempMatrix)
      const hits = raycaster.intersectObjects(
        environment ? [floor, environment] : [floor], true
      )
      if (!hits.length) return
      const hit    = hits[0].point
      const xrCam  = renderer.xr.getCamera()
      const head   = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld)
      playerRig.position.x = hit.x - (head.x - playerRig.position.x)
      playerRig.position.z = hit.z - (head.z - playerRig.position.z)
    }

    // ══════════════════════════════════════════
    //  VR MOVEMENT  ← FIX TRIỆT ĐỂ
    //
    //  Vấn đề gốc rễ: playerRig.rotation.y đã xoay cả không gian con.
    //  Khi ta dùng xrCam.getWorldDirection(), vector đó đã ở world space
    //  và ĐÚNG hướng người nhìn. NHƯNG khi cộng vào playerRig.position,
    //  playerRig lại bị xoay thêm lần nữa → sai.
    //
    //  Giải pháp đúng (standard locomotion pattern):
    //    1. Lấy forward/right của XR camera trong WORLD space
    //    2. Flatten xuống mặt phẳng XZ (bỏ Y)
    //    3. Di chuyển playerRig theo world-space vector đó
    //    → KHÔNG transform thêm gì nữa
    //
    //  Lý do các lần trước vẫn sai: code cũ lấy worldDirection() rồi
    //  lại nhân thêm rigQuat hoặc dùng crossVectors theo thứ tự sai,
    //  gây ra vector bị xoay thêm 90°.
    // ══════════════════════════════════════════
    const prevBtn = { 0: [], 1: [] }

    function handleXRMovement(delta) {
      const session = renderer.xr.getSession()
      if (!session) return

      const xrCam = renderer.xr.getCamera()
      xrCam.updateMatrixWorld(true)

      // ── World-space forward & right của đầu người dùng ──
      // applyQuaternion(worldQuat) lên unit vector = đúng hướng world space
      const worldQuat = new THREE.Quaternion()
      xrCam.getWorldQuaternion(worldQuat)

      // Forward: camera nhìn về -Z local → world space
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat)
      forward.y = 0
      forward.normalize()

      // Right: +X local → world space
      // crossVectors(up, forward) sẽ cho LEFT; ta dùng (forward, up) để có RIGHT
      const right = new THREE.Vector3()
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).negate() // negate → đúng right
      right.normalize()

      session.inputSources.forEach((src) => {
        const gp = src.gamepad
        if (!gp) return
        const idx  = src.handedness === 'left' ? 0 : 1
        const prev = prevBtn[idx] || []
        const curr = Array.from(gp.buttons).map(b => ({ pressed: b.pressed }))

        // Đọc axes: ưu tiên axes[2,3] (thumbstick); fallback axes[0,1]
        const ax    = gp.axes
        const DEAD  = 0.15
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
          const spd = 3 * delta
          // sy < 0 = đẩy lên trên joystick = đi về phía camera đang nhìn (forward)
          // sx > 0 = gạt phải joystick     = đi sang phải (right)
          playerRig.position.addScaledVector(forward,  -sy * spd)
          playerRig.position.addScaledVector(right,     sx * spd)
        }

        // Button 0 = trigger → teleport
        if (curr[0]?.pressed && !prev[0]?.pressed) {
          teleport(idx === 0 ? controller0 : controller1)
        }
        prevBtn[idx] = curr
      })
    }

    // ══════════════════════════════════════════
    //  ENTER VR
    // ══════════════════════════════════════════
    window.enterVR = async () => {
      if (!navigator.xr) { alert('WebXR not supported'); return }
      try {
        const session = await navigator.xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
        })
        renderer.xr.setSession(session)
      } catch (e) {
        alert('VR error: ' + e.message)
      }
    }

    // ══════════════════════════════════════════
    //  RESIZE + LOOP
    // ══════════════════════════════════════════
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
      if (renderer.xr.isPresenting) {
        handleXRMovement(delta)
      } else {
        controls.update()
      }
      renderer.render(scene, camera)
    })

    // ── Init ──
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
      <div className="viewer">
        <div ref={mountRef} className="canvas" />
      </div>

      <div className="sidebar">
        <h3>Models:</h3>
        {[
          ['default', '/models/avatar.glb',  'Mặc định'],
          ['a1',      '/models/avatar1.glb', 'Người đàn ông đang đợi'],
          ['a2',      '/models/avatar2.glb', 'Cô gái đang chụp ảnh'],
          ['a3',      '/models/avatar3.glb', 'Bé gái đứng 1 mình'],
          ['a4',      '/models/avatar4.glb', 'Chàng trai đang nhảy'],
        ].map(([key, path, label]) => (
          <button key={key}
            className={activeModel === key ? 'active' : ''}
            onClick={() => window.loadAvatar(path, key)}
          >{label}</button>
        ))}

        <hr />
        <h3>Backgrounds:</h3>
        {[
          ['room1', '/env/room1.glb', 'Trong nhà'],
          ['room2', '/env/room2.glb', 'Núi đá'],
          ['room3', '/env/room3.glb', 'Công viên'],
        ].map(([key, path, label]) => (
          <button key={key}
            className={activeEnv === key ? 'active' : ''}
            onClick={() => window.loadEnv(path, key)}
          >{label}</button>
        ))}

        <hr />
        <h4>Zoom x{envScaleUI}</h4>
        <input type="range" min="5" max="100" value={envScaleUI}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setEnvScaleUI(v)
            window.updateEnvScale(v)
          }}
        />
        <hr />
        <button className="vr-btn" onClick={() => window.enterVR()}>Enter VR</button>
      </div>
    </div>
  )
}