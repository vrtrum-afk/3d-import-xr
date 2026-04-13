import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js'
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

    const container = mountRef.current
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    document.body.appendChild(VRButton.createButton(renderer))

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

        const targetHeight = 2
        const scale = targetHeight / size.y
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
    // ENV (ADD ZOOM x20)
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

        const targetSize = 2 * envZoom
        const scale = targetSize / Math.max(size.x, size.z)
        environment.scale.setScalar(scale)

        scene.add(environment)
      })
    }

    function updateEnvScale(v) {
      envZoom = v
      if (environment) loadEnvironment('/env/room1.glb')
    }

    // =========================
    // 🔥 VR ADD-ON (KHÔNG PHÁ LEGACY)
    // =========================
    const controller1 = renderer.xr.getController(0)
    scene.add(controller1)

    const raycaster = new THREE.Raycaster()
    const tempMatrix = new THREE.Matrix4()

    let move = { forward: 0, right: 0 }
    const speed = 3

    function teleport(ctrl) {
      if (!environment) return

      tempMatrix.identity().extractRotation(ctrl.matrixWorld)

      raycaster.ray.origin.setFromMatrixPosition(ctrl.matrixWorld)
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix)

      const hit = raycaster.intersectObject(environment, true)[0]

      if (hit) {
        const xrCam = renderer.xr.getCamera()
        xrCam.position.set(hit.point.x, hit.point.y + 1.6, hit.point.z)
      }
    }

    controller1.addEventListener('selectstart', () => {
      if (renderer.xr.isPresenting) teleport(controller1)
    })

    function handleVRMovement(delta) {
      const session = renderer.xr.getSession()
      if (!session) return

      const xrCam = renderer.xr.getCamera()

      session.inputSources.forEach((source) => {
        if (!source.gamepad) return

        const axes = source.gamepad.axes

        move.forward = -axes[3] || 0
        move.right = axes[2] || 0
      })

      const dir = new THREE.Vector3()
      xrCam.getWorldDirection(dir)
      dir.y = 0
      dir.normalize()

      const right = new THREE.Vector3()
      right.crossVectors(dir, new THREE.Vector3(0, 1, 0))

      xrCam.position.addScaledVector(dir, move.forward * speed * delta)
      xrCam.position.addScaledVector(right, move.right * speed * delta)
    }

    // =========================
    // LOOP (SAFE)
    // =========================
    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta()
      if (mixer) mixer.update(delta)

      // 🔥 chỉ chạy khi vào VR
      if (renderer.xr.isPresenting) {
        handleVRMovement(delta)
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

    window.loadEnv = (path) => {
      loadEnvironment(path)
    }

    window.updateEnvScale = (v) => {
      updateEnvScale(v)
    }

    // =========================
    // RESIZE
    // =========================
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

      <div className="sidebar">
        <h3>Models:</h3>

        <button
          className={active === 'default' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar.glb', 'default')}
        >
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
      </div>
    </div>
  )
}

export default App