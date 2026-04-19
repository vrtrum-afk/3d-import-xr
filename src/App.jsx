import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory'
import './App.css'

function App() {
  const mountRef = useRef(null)
  const [activeModel, setActiveModel] = useState('default')
  const [activeEnv, setActiveEnv] = useState('room1')
  const [envScaleUI, setEnvScaleUI] = useState(25)

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
    let envZoom = 25
    let lastEnvPath = '/env/room1.glb'

    function loadEnvironment(path) {
      lastEnvPath = path
      loader.load(path, (gltf) => {
        if (environment) scene.remove(environment)
        environment = gltf.scene

        floor.visible = false
        grid.visible = false

        const box = new THREE.Box3().setFromObject(environment)
        const size = box.getSize(new THREE.Vector3())

        const envMaxHorizontal = Math.max(size.x, size.z)
        environment.scale.setScalar((2 * envZoom) / envMaxHorizontal)

        environment.updateMatrixWorld(true)
        const scaledBox = new THREE.Box3().setFromObject(environment)
        const scaledCenter = scaledBox.getCenter(new THREE.Vector3())

        environment.position.set(-scaledCenter.x, -scaledBox.min.y, -scaledCenter.z)
        scene.add(environment)
        environment.updateMatrixWorld(true)

        const groundRay = new THREE.Raycaster()
        groundRay.ray.origin.set(0, 1000, 0)
        groundRay.ray.direction.set(0, -1, 0)
        const hits = groundRay.intersectObject(environment, true)

        if (hits.length > 0) {
          environment.position.y += -hits[0].point.y - 0.02
        }
      })
    }

    function updateEnvScale(v) {
      envZoom = v
      if (environment) loadEnvironment(lastEnvPath)
    }

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
    const prevButtonState = { 0: [], 1: [] }

    function wasJustPressed(curr, prev, btnIndex) {
      return !!(curr[btnIndex]?.pressed && !prev[btnIndex]?.pressed)
    }

    // ================= XR MOVEMENT =================
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

        const axes = gp.axes
        let stickX = 0
        let stickY = 0
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
          const lookDir = new THREE.Vector3()
          xrCam.getWorldDirection(lookDir)
          lookDir.y = 0
          lookDir.normalize()

          const rightDir = new THREE.Vector3()
          rightDir.crossVectors(lookDir, new THREE.Vector3(0, 1, 0)).normalize()

          const speed = 3 * delta
          playerRig.position.addScaledVector(lookDir, -stickY * speed)
          playerRig.position.addScaledVector(rightDir, stickX * speed)
        }

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
    loadEnvironment('/env/room1.glb')

    window.loadAvatar = (path, key) => {
      loadModel(path)
      setActiveModel(key)
    }
    window.loadEnv = (path, key) => {
      loadEnvironment(path)
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
          Người đàn ông đẩy hàng
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
          Công viên
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
          Trong nhà
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
