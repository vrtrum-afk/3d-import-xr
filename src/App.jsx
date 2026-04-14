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

        const scale = 2 / size.y
        model.scale.setScalar(scale)

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

    function loadEnvironment(path) {
      loader.load(path, (gltf) => {
        if (environment) scene.remove(environment)

        environment = gltf.scene

        const box = new THREE.Box3().setFromObject(environment)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())

        environment.position.set(-center.x, -box.min.y, -center.z)

        const scale = (2 * envZoom) / Math.max(size.x, size.z)
        environment.scale.setScalar(scale)

        scene.add(environment)
      })
    }

    function updateEnvScale(v) {
      envZoom = v
      if (environment) loadEnvironment('/env/room1.glb')
    }

    // ================= CONTROLLERS (cả 2) =================
    const factory = new XRControllerModelFactory()

    const controller0 = renderer.xr.getController(0)
    const controller1 = renderer.xr.getController(1)
    scene.add(controller0)
    scene.add(controller1)

    const grip0 = renderer.xr.getControllerGrip(0)
    const grip1 = renderer.xr.getControllerGrip(1)
    grip0.add(factory.createControllerModel(grip0))
    grip1.add(factory.createControllerModel(grip1))
    scene.add(grip0)
    scene.add(grip1)

    // Ray line visual để thấy hướng bắn tia
    const rayGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -5)
    ])
    const rayMat = new THREE.LineBasicMaterial({ color: 0x00ffff })
    controller0.add(new THREE.Line(rayGeo, rayMat))
    controller1.add(new THREE.Line(rayGeo.clone(), rayMat.clone()))

    const raycaster = new THREE.Raycaster()
    const tempMatrix = new THREE.Matrix4()

    // ================= TELEPORT =================
    function teleportFromController(ctrl) {
      if (!environment) return

      tempMatrix.identity().extractRotation(ctrl.matrixWorld)
      raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld)
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix)

      const hits = raycaster.intersectObject(environment, true)
      if (hits.length > 0) {
        const cam = renderer.xr.getCamera()
        cam.position.set(hits[0].point.x, hits[0].point.y + 1.6, hits[0].point.z)
      }
    }

    // ================= INPUT STATE =================
    // Poll button state thay vì dùng events (PICO events không reliable)
    const prevButtons = { 0: [], 1: [] }

    function wasJustPressed(currBtns, prevBtns, index) {
      return !!(currBtns[index]?.pressed && !prevBtns[index]?.pressed)
    }

    // ================= HYBRID MOVEMENT =================
    function handleMovement(delta) {
      const cam = renderer.xr.getCamera()
      const session = renderer.xr.getSession()
      if (!session) return

      session.inputSources.forEach((source) => {
        const gp = source.gamepad
        if (!gp) return

        // Xác định index controller (left=0, right=1)
        const idx = source.handedness === 'left' ? 0 : 1
        const prevBtns = prevButtons[idx] || []
        const currBtns = [...gp.buttons].map(b => ({ pressed: b.pressed, value: b.value }))

        // ---- PICO 4 Axes Layout ----
        // axes[0], axes[1] = touchpad (ít dùng)
        // axes[2], axes[3] = thumbstick X/Y  <-- chính xác cho PICO 4
        // Fallback về [0],[1] nếu axes ngắn hơn 4
        const axes = gp.axes
        let stickX = 0
        let stickY = 0

        if (axes.length >= 4) {
          stickX = Math.abs(axes[2]) > 0.12 ? axes[2] : 0
          stickY = Math.abs(axes[3]) > 0.12 ? axes[3] : 0
          // Fallback nếu axes[2/3] đều 0
          if (stickX === 0 && stickY === 0) {
            stickX = Math.abs(axes[0]) > 0.12 ? axes[0] : 0
            stickY = Math.abs(axes[1]) > 0.12 ? axes[1] : 0
          }
        } else if (axes.length >= 2) {
          stickX = Math.abs(axes[0]) > 0.12 ? axes[0] : 0
          stickY = Math.abs(axes[1]) > 0.12 ? axes[1] : 0
        }

        // Di chuyển bằng thumbstick
        const forward = -stickY
        const right = stickX

        if (Math.abs(forward) > 0 || Math.abs(right) > 0) {
          const dir = new THREE.Vector3()
          cam.getWorldDirection(dir)
          dir.y = 0
          dir.normalize()

          const side = new THREE.Vector3()
          side.crossVectors(dir, new THREE.Vector3(0, 1, 0))

          cam.position.addScaledVector(dir, forward * 3 * delta)
          cam.position.addScaledVector(side, right * 3 * delta)
        }

        // ---- Teleport bằng Trigger (button index 0) ----
        // PICO 4: button[0] = trigger, button[1] = grip/squeeze
        if (wasJustPressed(currBtns, prevBtns, 0)) {
          const ctrl = idx === 0 ? controller0 : controller1
          teleportFromController(ctrl)
        }

        // Cập nhật trạng thái button frame trước
        prevButtons[idx] = currBtns
      })
    }

    // ================= XR =================
    window.enterVR = async () => {
      try {
        const session = await navigator.xr.requestSession('immersive-vr', {
          optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
        })
        renderer.xr.setSession(session)
      } catch (err) {
        console.error('VR session error:', err)
        alert('Không thể khởi động VR: ' + err.message)
      }
    }

    // ================= LOOP =================
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta()
      if (mixer) mixer.update(delta)

      if (renderer.xr.isPresenting) {
        handleMovement(delta)
      }

      controls.update()
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
      const width = container.clientWidth
      const height = container.clientHeight
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    }

    resize()
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
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
