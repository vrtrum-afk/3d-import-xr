import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js'
import './App.css'

function App() {
  const mountRef = useRef(null)
  const [active, setActive] = useState('default')
  const [envScaleUI, setEnvScaleUI] = useState(10)

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

    const loader = new GLTFLoader()
    const clock = new THREE.Clock()

    let mixer = null
    let currentModel = null
    let environment = null

    // 🔥 GLOBAL STATE
    let modelHeight = 2
    let envZoom = 10
    let envBaseSize = null
    let envGroundOffset = 0

    const raycaster = new THREE.Raycaster()

    // =========================
    // 🔥 MODEL NORMALIZE
    // =========================
    function normalizeModel(model) {
      model.scale.set(1, 1, 1)

      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())

      const minY = box.min.y

      model.position.set(-center.x, -minY, -center.z)

      const targetHeight = 2
      const scale = targetHeight / size.y
      model.scale.setScalar(scale)

      modelHeight = targetHeight
    }

    // =========================
    // 🔥 ENV NORMALIZE
    // =========================
    function normalizeEnvironment(env) {
      if (!envBaseSize) return

      const targetSize = modelHeight * envZoom
      const scale = targetSize / Math.max(envBaseSize.x, envBaseSize.z)

      env.scale.setScalar(scale)

      env.position.x = 0
      env.position.z = 0

      env.position.y = -envGroundOffset * scale
    }

    function updateEnvScale(v) {
      envZoom = v
      if (environment) normalizeEnvironment(environment)
    }

    // =========================
    // 🔥 RAYCAST GROUNDING (PRO)
    // =========================
    function groundModelToEnvironment() {
      if (!currentModel || !environment) return

      const origin = new THREE.Vector3(0, 5, 0) // bắn từ trên xuống
      const direction = new THREE.Vector3(0, -1, 0)

      raycaster.set(origin, direction)

      const intersects = raycaster.intersectObject(environment, true)

      if (intersects.length > 0) {
        const hit = intersects[0]
        currentModel.position.y = hit.point.y
      }
    }

    // =========================
    // 🔥 LOAD MODEL
    // =========================
    function loadModel(path) {
      loader.load(path, (gltf) => {
        if (currentModel) scene.remove(currentModel)

        const model = gltf.scene
        currentModel = model

        normalizeModel(model)
        scene.add(model)

        if (environment) {
          normalizeEnvironment(environment)

          // 🔥 grounding chuẩn
          setTimeout(() => {
            groundModelToEnvironment()
          }, 50)
        }

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
    // 🔥 LOAD ENV
    // =========================
    function loadEnvironment(path) {
      loader.load(path, (gltf) => {
        if (environment) scene.remove(environment)

        environment = gltf.scene

        environment.scale.set(1, 1, 1)

        const box = new THREE.Box3().setFromObject(environment)
        const size = box.getSize(new THREE.Vector3())
        const center = box.getCenter(new THREE.Vector3())

        envBaseSize = size.clone()
        envGroundOffset = box.min.y

        environment.position.set(-center.x, -envGroundOffset, -center.z)

        normalizeEnvironment(environment)

        scene.add(environment)

        // 🔥 grounding lại model
        setTimeout(() => {
          groundModelToEnvironment()
        }, 50)
      })
    }

    // =========================
    // 🔥 DEFAULT
    // =========================
    loadModel('/models/avatar.glb')
    loadEnvironment('/env/room1.glb')

    // =========================
    // 🔥 LEGACY API
    // =========================
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
    // 🔥 RESIZE
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

    renderer.setAnimationLoop(() => {
      const delta = clock.getDelta()
      if (mixer) mixer.update(delta)

      controls.update()
      renderer.render(scene, camera)
    })
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

        <h4>Env Zoom (default = 10x)</h4>
        <input
          type="range"
          min="1"
          max="20"
          step="0.1"
          value={envScaleUI}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setEnvScaleUI(v)
            window.updateEnvScale(v)
          }}
        />

        <hr />

        <button className="vr-btn">
          Enter VR
        </button>
      </div>
    </div>
  )
}

export default App