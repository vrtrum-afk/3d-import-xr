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

    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'

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

    // =========================
    // MODEL (GIỮ NGUYÊN)
    // =========================
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

    // =========================
    // ENV (ZOOM x20)
    // =========================
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

    // =========================
    // CONTROLLER (HIỂN THỊ)
    // =========================
    const controller = renderer.xr.getController(0)
    scene.add(controller)

    const factory = new XRControllerModelFactory()
    const grip = renderer.xr.getControllerGrip(0)
    grip.add(factory.createControllerModel(grip))
    scene.add(grip)

    // =========================
    // MOVEMENT
    // =========================
    let moving = false
    let fallbackAutoMove = true // 🔥 fallback nếu Pico không có input

    function moveForward(delta) {
      if (!moving && !fallbackAutoMove) return

      const cam = renderer.xr.getCamera()

      const dir = new THREE.Vector3()
      cam.getWorldDirection(dir)
      dir.y = 0
      dir.normalize()

      cam.position.addScaledVector(dir, 2 * delta)
    }

    // =========================
    // TELEPORT
    // =========================
    const raycaster = new THREE.Raycaster()
    const tempMatrix = new THREE.Matrix4()

    function teleport() {
      if (!environment) return

      tempMatrix.identity().extractRotation(controller.matrixWorld)

      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld)
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix)

      const hit = raycaster.intersectObject(environment, true)[0]

      if (hit) {
        const cam = renderer.xr.getCamera()
        cam.position.set(hit.point.x, hit.point.y + 1.6, hit.point.z)
      }
    }

    // =========================
    // XR START (FIX CHUẨN)
    // =========================
    window.enterVR = async () => {
      try {
        const session = await navigator.xr.requestSession('immersive-vr', {
          requiredFeatures: ['local-floor']
        })

        renderer.xr.setSession(session)

        console.log('✅ VR START')

        // 🔥 bind event tại session (Pico safe)
        session.addEventListener('selectstart', () => {
          console.log('selectstart')
          moving = true
          fallbackAutoMove = false
          teleport()
        })

        session.addEventListener('selectend', () => {
          console.log('selectend')
          moving = false
        })

        session.addEventListener('inputsourceschange', () => {
          console.log('inputSources:', session.inputSources)
        })

      } catch (e) {
        console.error('XR FAIL', e)
      }
    }

    // =========================
    // LOOP
    // =========================
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta()
      if (mixer) mixer.update(delta)

      if (renderer.xr.isPresenting) {
        moveForward(delta)
      }

      controls.update()
      renderer.render(scene, camera)
    })

    // =========================
    // DEFAULT
    // =========================
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

        <h4>Zoom x20</h4>
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