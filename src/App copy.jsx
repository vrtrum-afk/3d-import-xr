import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js'
import './App.css'

function App() {
  const mountRef = useRef(null)
  const [active, setActive] = useState('default')

  useEffect(() => {
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x0d0d0d)

    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000)

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(window.devicePixelRatio)

    // 🔥 bật VR
    renderer.xr.enabled = true

    const container = mountRef.current
    container.innerHTML = ''
    container.appendChild(renderer.domElement)

    // thêm nút VR
    document.body.appendChild(VRButton.createButton(renderer))

    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.2))

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

    const loader = new GLTFLoader()
    const clock = new THREE.Clock()

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

        const maxDim = Math.max(size.x, size.y, size.z)
        const distance = maxDim * 2

        camera.position.set(0, maxDim, distance)
        controls.target.set(0, maxDim * 0.5, 0)
        controls.update()

        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model)
          mixer.clipAction(gltf.animations[0]).play()
        }
      })
    }

    // default
    loadModel('/models/avatar.glb')

    window.loadAvatar = (path, key) => {
      loadModel(path)
      setActive(key)
    }

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
        <h3>Avatars</h3>

        <button
          className={active === 'default' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar.glb', 'default')}
        >
          Mặc định
        </button>

        <button
          className={active === 'a1' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar1.glb', 'a1')}
        >
          Người đàn ông đang đợi
        </button>

        <button
          className={active === 'a2' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar2.glb', 'a2')}
        >
          Cô gái đang chụp ảnh
        </button>

        <button
          className={active === 'a3' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar3.glb', 'a3')}
        >
          Người đàn ông đẩy hàng
        </button>

        <button
          className={active === 'a4' ? 'active' : ''}
          onClick={() => window.loadAvatar('/models/avatar4.glb', 'a4')}
        >
          Chàng trai đang nhảy
        </button>

        <hr />

        <button className="vr-btn">
          Enter VR
        </button>
      </div>
    </div>
  )
}

export default App