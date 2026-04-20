import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory'
import './App.css'

const ENV_CONFIG = {
  room3: {
    envScale:     45,
    centerOffset: { x: 0, z: 0 },
    cameraPos:    { x: 0,   y: 1.6, z:  2  },
    cameraTarget: { x: 0,   y: 1.2, z: -2  },
    modelPos:     { x: 0,   y: 0,   z: -3  },
    modelRotY:    0,
    modelHeight:  1.7,
  },
  room2: {
    envScale:     25,
    centerOffset: { x: 0, z: 0 },
    cameraPos:    { x: 0,   y: 1.6, z:  2  },
    cameraTarget: { x: 0,   y: 1.2, z: -2  },
    modelPos:     { x: 0,   y: 0,   z:  0  },
    modelRotY:    0,
    modelHeight:  1.7,
  },
  room1: {
    envScale:     45,
    centerOffset: { x: -15, z: 0 },
    // cameraPos.y = modelPos.y + 1.6 (mắt người cao 1.7m)
    // modelPos.y = -6 → cameraPos.y = -6 + 1.6 = -4.4
    cameraPos:    { x: -13, y: -4.4, z: 0 },
    cameraTarget: { x: -25, y: -4.9, z: 0 },
    modelPos:     { x: -35, y: -6,   z: 0 },
    modelRotY:    14.2,
    modelHeight:  null, // tự tính theo dist * 0.1
  },
}

function App() {
  const mountRef = useRef(null)
  const [activeModel, setActiveModel] = useState('default')
  const [activeEnv, setActiveEnv]     = useState('room1')
  const [envScaleUI, setEnvScaleUI]   = useState(45)

  useEffect(() => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0d0d)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.xr.enabled = true
    renderer.xr.setReferenceSpaceType('local-floor')

    const container = mountRef.current
    container.innerHTML = ''
    container.appendChild(renderer.domElement)
    renderer.domElement.style.display = 'block'
    renderer.domElement.style.width   = '100%'
    renderer.domElement.style.height  = '100%'

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2))
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))

    const grid = new THREE.GridHelper(20, 20)
    scene.add(grid)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({ color: 0x0d0d0d })
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)

    const playerRig = new THREE.Group()
    playerRig.position.set(0, 0, 0)
    scene.add(playerRig)
    playerRig.add(camera)

    let mixer         = null
    let currentModel  = null
    let environment   = null
    let currentEnvKey = 'room1'
    let envZoom       = 45
    let lastEnvPath   = '/env/room1.glb'
    let activeCfg     = ENV_CONFIG['room1']

    const loader = new GLTFLoader()
    const clock  = new THREE.Clock()

    // ================= MODEL HEIGHT =================
    function calcModelHeight(cfg) {
      if (cfg.modelHeight != null) return cfg.modelHeight
      const dx   = cfg.cameraPos.x - cfg.modelPos.x
      const dz   = cfg.cameraPos.z - cfg.modelPos.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      return dist * 0.1
    }

    // ================= PLACE MODEL =================
    function placeModel(model, cfg) {
      const targetH = calcModelHeight(cfg)

      // 1. Scale theo chiều cao mong muốn
      const rawBox  = new THREE.Box3().setFromObject(model)
      const rawSize = rawBox.getSize(new THREE.Vector3())
      model.scale.setScalar(targetH / rawSize.y)

      // 2. Đặt rotation trước
      model.rotation.y = cfg.modelRotY ?? 0

      // 3. Đặt position X/Z, y tạm = cfg.modelPos.y
      model.position.set(cfg.modelPos.x, cfg.modelPos.y, cfg.modelPos.z)

      // 4. updateMatrixWorld SAU KHI đã set scale + position + rotation
      model.updateMatrixWorld(true)

      // 5. Tính footOffset: đáy bbox hiện tại so với y mong muốn
      const scaledBox  = new THREE.Box3().setFromObject(model)
      const footOffset = scaledBox.min.y - cfg.modelPos.y

      // 6. Trừ footOffset để đáy model = cfg.modelPos.y (chân đứng đúng sàn)
      model.position.y -= footOffset
    }

    // ================= LOAD MODEL =================
    function loadModel(path) {
      loader.load(path, (gltf) => {
        if (currentModel) scene.remove(currentModel)
        const model  = gltf.scene
        currentModel = model
        scene.add(model)

        const cfg = ENV_CONFIG[currentEnvKey] || ENV_CONFIG['room1']
        placeModel(model, cfg)

        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model)
          mixer.clipAction(gltf.animations[0]).play()
        }
      })
    }

    // ================= ENV =================
    function applyEnvConfig(cfg) {
      activeCfg = cfg
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

      const cfg = ENV_CONFIG[key] || ENV_CONFIG['room1']
      if (cfg.envScale !== undefined) envZoom = cfg.envScale

      loader.load(path, (gltf) => {
        if (environment) scene.remove(environment)
        environment = gltf.scene

        floor.visible = false
        grid.visible  = false

        const box  = new THREE.Box3().setFromObject(environment)
        const size = box.getSize(new THREE.Vector3())
        const envMaxHorizontal = Math.max(size.x, size.z)
        environment.scale.setScalar((2 * envZoom) / envMaxHorizontal)

        environment.updateMatrixWorld(true)
        const scaledBox    = new THREE.Box3().setFromObject(environment)
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3())
        environment.position.set(
          -scaledCenter.x + (cfg.centerOffset?.x ?? 0),
          -scaledBox.min.y,
          -scaledCenter.z + (cfg.centerOffset?.z ?? 0)
        )
        scene.add(environment)
        environment.updateMatrixWorld(true)

        const groundRay = new THREE.Raycaster()
        groundRay.ray.origin.set(cfg.cameraPos.x, 1000, cfg.cameraPos.z)
        groundRay.ray.direction.set(0, -1, 0)
        const hits = groundRay.intersectObject(environment, true)
        if (hits.length > 0) {
          environment.position.y += -hits[0].point.y
        }

        applyEnvConfig(cfg)
      })
    }

    function updateEnvScale(v) {
      envZoom = v
      if (environment) loadEnvironment(lastEnvPath, currentEnvKey)
    }

    // ================= VR ALIGN =================
    renderer.xr.addEventListener('sessionstart', () => {
      setTimeout(() => {
        const cfg   = activeCfg
        const xrCam = renderer.xr.getCamera()
        xrCam.updateMatrixWorld(true)

        // Bù vị trí
        const xrPos = new THREE.Vector3()
        xrPos.setFromMatrixPosition(xrCam.matrixWorld)
        playerRig.position.x += cfg.cameraPos.x - xrPos.x
        playerRig.position.y += cfg.cameraPos.y - xrPos.y
        playerRig.position.z += cfg.cameraPos.z - xrPos.z

        // Bù hướng nhìn
        const desiredDir = new THREE.Vector3(
          cfg.cameraTarget.x - cfg.cameraPos.x,
          0,
          cfg.cameraTarget.z - cfg.cameraPos.z
        ).normalize()

        const headDir = new THREE.Vector3()
        xrCam.getWorldDirection(headDir)
        headDir.y = 0
        headDir.normalize()

        const desiredAngle = Math.atan2(desiredDir.x, desiredDir.z)
        const currentAngle = Math.atan2(headDir.x,    headDir.z)
        playerRig.rotation.y = desiredAngle - currentAngle
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

    // ================= CONTROLLERS =================
    const factory = new XRControllerModelFactory()

    const controller0 = renderer.xr.getController(0)
    const controller1 = renderer.xr.getController(1)
    playerRig.add(controller0)
    playerRig.add(controller1)

    const grip0 = renderer.xr.getControllerGrip(0)
    const grip1 = renderer.xr.getControllerGrip(1)
    grip0.add(factory.createControllerModel(grip0))
    grip1.add(factory.createControllerModel(grip1))
    playerRig.add(grip0)
    playerRig.add(grip1)

    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0,  0),
      new THREE.Vector3(0, 0, -8)
    ])
    const rayMat = new THREE.LineBasicMaterial({ color: 0x00ffff })
    controller0.add(new THREE.Line(rayGeo,         rayMat))
    controller1.add(new THREE.Line(rayGeo.clone(), rayMat.clone()))

    const raycaster  = new THREE.Raycaster()
    const tempMatrix = new THREE.Matrix4()

    // ================= TELEPORT =================
    function teleportFromController(ctrl) {
      tempMatrix.identity().extractRotation(ctrl.matrixWorld)
      raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld)
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix)

      const targets = [floor]
      if (environment) targets.push(environment)
      const hits = raycaster.intersectObjects(targets, true)

      if (hits.length > 0) {
        const hit       = hits[0].point
        const xrCam     = renderer.xr.getCamera()
        const headWorld = new THREE.Vector3()
        headWorld.setFromMatrixPosition(xrCam.matrixWorld)

        playerRig.position.x = hit.x - (headWorld.x - playerRig.position.x)
        playerRig.position.z = hit.z - (headWorld.z - playerRig.position.z)
      }
    }

    // ================= GAMEPAD =================
    const prevButtonState = { 0: [], 1: [] }

    function wasJustPressed(curr, prev, btnIndex) {
      return !!(curr[btnIndex]?.pressed && !prev[btnIndex]?.pressed)
    }

    // ================= XR MOVEMENT =================
    // ROOT CAUSE joystick sai: axes của WebXR controller KHÔNG map vào
    // lookDir/rightDir theo cách thông thường. Cần dùng hướng headset
    // trong LOCAL space của playerRig (không phải world space) để tránh
    // double-rotation do rigYaw.
    //
    // Cách đúng:
    //   - Lấy quaternion của XR camera trong world space
    //   - Tách bỏ phần Y-rotation của playerRig ra khỏi quaternion đó
    //   - Còn lại là hướng nhìn thuần tuý của đầu người dùng
    //   - Dùng hướng đó để tính forward/right rồi move playerRig
    function handleXRMovement(delta) {
      const session = renderer.xr.getSession()
      if (!session) return

      const xrCam = renderer.xr.getCamera()

      session.inputSources.forEach((source) => {
        const gp = source.gamepad
        if (!gp) return

        const idx  = source.handedness === 'left' ? 0 : 1
        const prev = prevButtonState[idx] || []
        const curr = Array.from(gp.buttons).map(b => ({ pressed: b.pressed, value: b.value }))

        const axes = gp.axes
        let stickX = 0, stickY = 0
        const DEAD = 0.15

        if (axes.length >= 4) {
          if (Math.abs(axes[2]) > DEAD) stickX = axes[2]
          if (Math.abs(axes[3]) > DEAD) stickY = axes[3]
        }
        if (stickX === 0 && stickY === 0 && axes.length >= 2) {
          if (Math.abs(axes[0]) > DEAD) stickX = axes[0]
          if (Math.abs(axes[1]) > DEAD) stickY = axes[1]
        }

        if (stickX !== 0 || stickY !== 0) {
          // Lấy world-space quaternion của XR camera
          const worldQuat = new THREE.Quaternion()
          xrCam.getWorldQuaternion(worldQuat)

          // Tách phần Y-rotation của playerRig ra để lấy head-local yaw
          const rigQuat    = new THREE.Quaternion()
          rigQuat.setFromEuler(new THREE.Euler(0, playerRig.rotation.y, 0))
          const rigQuatInv = rigQuat.clone().invert()

          // headQuat = rotation thuần của đầu người dùng (không bị ảnh hưởng bởi rig)
          const headQuat = rigQuatInv.multiply(worldQuat)

          // Forward của head trong local-rig space, chiếu xuống mặt phẳng ngang
          const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat)
          forward.y = 0
          forward.normalize()

          const right = new THREE.Vector3(1, 0, 0).applyQuaternion(worldQuat)
          right.y = 0
          right.normalize()

          const speed = 3 * delta
          // stickY âm = đẩy lên trước → tiến (forward)
          // stickX dương = gạt phải → đi phải (right)
          playerRig.position.addScaledVector(forward, -stickY * speed)
          playerRig.position.addScaledVector(right,    stickX * speed)
        }

        if (wasJustPressed(curr, prev, 0)) {
          teleportFromController(idx === 0 ? controller0 : controller1)
        }

        prevButtonState[idx] = curr
      })
    }

    // ================= ENTER VR =================
    window.enterVR = async () => {
      if (!navigator.xr) {
        alert('WebXR không được hỗ trợ trên trình duyệt này')
        return
      }
      try {
        const session = await navigator.xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
        })
        renderer.xr.setSession(session)
      } catch (err) {
        console.error('VR error:', err)
        alert('Không thể vào VR: ' + err.message)
      }
    }

    // ================= RESIZE =================
    function resize() {
      const rect = container.getBoundingClientRect()
      const w = Math.floor(rect.width)
      const h = Math.floor(rect.height)
      if (w === 0 || h === 0) return
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    // ================= LOOP =================
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

    // ================= INIT =================
    loadModel('/models/avatar.glb')
    loadEnvironment('/env/room1.glb', 'room1')

    window.loadAvatar = (path, key) => {
      loadModel(path)
      setActiveModel(key)
    }
    window.loadEnv = (path, key) => {
      loadEnvironment(path, key)
      setActiveEnv(key)
    }
    window.updateEnvScale = (v) => updateEnvScale(v)

    resize()
    const ro = new ResizeObserver(() => resize())
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
        <div ref={mountRef} className="canvas"></div>
      </div>

      <div className="sidebar">
        <h3>Models:</h3>

        <button
          className={activeModel === 'default' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar.glb', 'default')}
        >
          Mặc định
        </button>

        <button
          className={activeModel === 'a1' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar1.glb', 'a1')}
        >
          Người đàn ông đang đợi
        </button>

        <button
          className={activeModel === 'a2' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar2.glb', 'a2')}
        >
          Cô gái đang chụp ảnh
        </button>

        <button
          className={activeModel === 'a3' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar3.glb', 'a3')}
        >
          Bé gái đứng 1 mình
        </button>

        <button
          className={activeModel === 'a4' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar4.glb', 'a4')}
        >
          Chàng trai đang nhảy
        </button>

        <hr />

        <h3>Backgrounds:</h3>

        <button
          className={activeEnv === 'room1' ? 'active' : ''}
          onClick={() => window.loadEnv('/env/room1.glb', 'room1')}
        >
          Trong nhà
        </button>

        <button
          className={activeEnv === 'room2' ? 'active' : ''}
          onClick={() => window.loadEnv('/env/room2.glb', 'room2')}
        >
          Núi đá
        </button>

        <button
          className={activeEnv === 'room3' ? 'active' : ''}
          onClick={() => window.loadEnv('/env/room3.glb', 'room3')}
        >
          Công viên
        </button>

        <hr />

        <h4>Zoom x{envScaleUI}</h4>
        <input
          type="range"
          min="5"
          max="100"
          value={envScaleUI}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setEnvScaleUI(v)
            window.updateEnvScale(v)
          }}
        />

        <hr />

        <button className="vr-btn" onClick={() => window.enterVR()}>
          Enter VR
        </button>
      </div>
    </div>
  )
}

export default App