import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory'
import './App.css'

function App() {
  const mountRef = useRef(null)
  const [active, setActive] = useState('default')
  const [envScaleUI, setEnvScaleUI] = useState(20)

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

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2))
    scene.add(new THREE.AmbientLight(0xffffff, 0.5))

    const grid = new THREE.GridHelper(20, 20)
    scene.add(grid)

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(50, 50),
      new THREE.MeshStandardMaterial({ color: 0x111111 })
    )
    floor.rotation.x = -Math.PI / 2
    scene.add(floor)

    // ================= PLAYER RIG =================
    // Điểm mấu chốt: trong WebXR KHÔNG được move camera trực tiếp.
    // XR override camera position mỗi frame từ tracking data của kính.
    // Phải tạo Group (playerRig) làm "thân người", add camera + controllers vào.
    // Muốn di chuyển → dịch chuyển playerRig, XR tự offset camera theo.
    const playerRig = new THREE.Group()
    playerRig.position.set(0, 0, 3)
    scene.add(playerRig)
    playerRig.add(camera)

    let mixer = null
    let currentModel = null
    let environment = null

    const loader = new GLTFLoader()
    const clock = new THREE.Clock()

    // ================= MODEL =================
    function loadModel(path) {
      loader.load(path, (gltf) => {
        if (currentModel) scene.remove(currentModel)
        const model = gltf.scene
        currentModel = model
        scene.add(model)

        const box = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())

        model.position.set(-center.x, -box.min.y, -center.z)
        model.scale.setScalar(2 / size.y)

        camera.position.set(0, 1.5, 4)
        controls.target.set(0, 1, 0)
        controls.update()

        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model)
          mixer.clipAction(gltf.animations[0]).play()
        }
      })
    }

    // ================= ENV =================
    let envZoom = 20
    let lastEnvPath = '/env/room1.glb'

    function loadEnvironment(path) {
      lastEnvPath = path
      loader.load(path, (gltf) => {
        if (environment) scene.remove(environment)
        environment = gltf.scene

        const box = new THREE.Box3().setFromObject(environment)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())

        environment.position.set(-center.x, -box.min.y, -center.z)
        environment.scale.setScalar((2 * envZoom) / Math.max(size.x, size.z))

        scene.add(environment)
      })
    }

    function updateEnvScale(v) {
      envZoom = v
      if (environment) loadEnvironment(lastEnvPath)
    }

    // ================= CONTROLLERS =================
    // Controllers phải add vào playerRig (không phải scene)
    // để khi rig dịch chuyển, tay controller cũng dịch theo
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

    // Ray line để thấy hướng bắn tia teleport
    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -8)
    ])
    const rayMat = new THREE.LineBasicMaterial({ color: 0x00ffff })
    controller0.add(new THREE.Line(rayGeo, rayMat))
    controller1.add(new THREE.Line(rayGeo.clone(), rayMat.clone()))

    const raycaster = new THREE.Raycaster()
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
        const hit = hits[0].point
        // Tính offset của đầu so với rig để giữ đúng vị trí head
        const xrCam = renderer.xr.getCamera()
        const headWorld = new THREE.Vector3()
        headWorld.setFromMatrixPosition(xrCam.matrixWorld)
        const headOffsetX = headWorld.x - playerRig.position.x
        const headOffsetZ = headWorld.z - playerRig.position.z

        playerRig.position.x = hit.x - headOffsetX
        playerRig.position.z = hit.z - headOffsetZ
      }
    }

    // ================= GAMEPAD POLLING =================
    // PICO 4 không fire events selectstart/squeeze ổn định khi isPresenting
    // Phải poll gamepad.buttons mỗi frame và so sánh với frame trước
    const prevButtonState = { 0: [], 1: [] }

    function wasJustPressed(curr, prev, btnIndex) {
      return !!(curr[btnIndex]?.pressed && !prev[btnIndex]?.pressed)
    }

    // ================= XR MOVEMENT =================
    // Hướng di chuyển lấy từ góc nhìn của xrCamera (head)
    // nhưng áp dụng lên playerRig — KHÔNG áp dụng lên camera
    function handleXRMovement(delta) {
      const session = renderer.xr.getSession()
      if (!session) return

      const xrCam = renderer.xr.getCamera()

      session.inputSources.forEach((source) => {
        const gp = source.gamepad
        if (!gp) return

        const idx = source.handedness === 'left' ? 0 : 1
        const prev = prevButtonState[idx] || []
        const curr = Array.from(gp.buttons).map(b => ({ pressed: b.pressed, value: b.value }))

        // ---- THUMBSTICK ----
        // PICO 4 WebXR axes layout:
        // axes[0] = touchpad X  (không dùng)
        // axes[1] = touchpad Y  (không dùng)
        // axes[2] = thumbstick X  ← dùng cái này
        // axes[3] = thumbstick Y  ← và cái này
        const axes = gp.axes
        let stickX = 0
        let stickY = 0
        const DEAD = 0.15

        if (axes.length >= 4) {
          if (Math.abs(axes[2]) > DEAD) stickX = axes[2]
          if (Math.abs(axes[3]) > DEAD) stickY = axes[3]
        }
        // Fallback cho firmware cũ hoặc layout axes khác
        if (stickX === 0 && stickY === 0 && axes.length >= 2) {
          if (Math.abs(axes[0]) > DEAD) stickX = axes[0]
          if (Math.abs(axes[1]) > DEAD) stickY = axes[1]
        }

        if (stickX !== 0 || stickY !== 0) {
          // Lấy hướng nhìn từ xrCamera, flatten XZ
          const lookDir = new THREE.Vector3()
          xrCam.getWorldDirection(lookDir)
          lookDir.y = 0
          lookDir.normalize()

          const rightDir = new THREE.Vector3()
          rightDir.crossVectors(lookDir, new THREE.Vector3(0, 1, 0)).normalize()

          // Di chuyển playerRig (KHÔNG phải camera)
          const speed = 3 * delta
          playerRig.position.addScaledVector(lookDir, -stickY * speed)
          playerRig.position.addScaledVector(rightDir, stickX * speed)
        }

        // ---- TRIGGER (button[0]) → teleport ----
        if (wasJustPressed(curr, prev, 0)) {
          const ctrl = idx === 0 ? controller0 : controller1
          teleportFromController(ctrl)
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
    loadEnvironment('/env/room1.glb')

    window.loadAvatar = (path, key) => {
      loadModel(path)
      setActive(key)
    }
    window.loadEnv = (path) => loadEnvironment(path)
    window.updateEnvScale = (v) => updateEnvScale(v)

    function resize() {
      const w = container.clientWidth
      const h = container.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }

    resize()
    window.addEventListener('resize', resize)

    return () => {
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

      <div className="sidebar" style={{ overflowY: 'auto', maxHeight: '100vh' }}>
        <h3>Models:</h3>

        <button className={active === 'default' ? 'active' : ''} onClick={() => window.loadAvatar('/models/avatar.glb', 'default')}>
          Mặc định
        </button>

        <button onClick={() => window.loadAvatar('/models/avatar1.glb', 'a1')}>
          Người đàn ông đang đợi
        </button>

        <button onClick={() => window.loadAvatar('/models/avatar2.glb', 'a2')}>
          Cô gái đang chụp ảnh
        </button>

        <button onClick={() => window.loadAvatar('/models/avatar3.glb', 'a3')}>
          Người đàn ông đẩy hàng
        </button>

        <button onClick={() => window.loadAvatar('/models/avatar4.glb', 'a4')}>
          Chàng trai đang nhảy
        </button>

        <hr />

        <h3>Background</h3>

        <button onClick={() => window.loadEnv('/env/room1.glb')}>
          Room 1
        </button>

        <button onClick={() => window.loadEnv('/env/room2.glb')}>
          Room 2
        </button>

        <hr />

        <h4>Zoom x{envScaleUI}</h4>
        <input
          type="range"
          min="5"
          max="50"
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
