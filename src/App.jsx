import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory'
import './App.css'

// ================= ENV CONFIG =================
// envScale    : zoom môi trường
// centerOffset: dịch chuyển env sau khi căn bounding box — dùng để bù lệch
//               khi "phần phòng thực tế" không nằm ở tâm bounding box
//               (ví dụ room3 có nền trắng rộng bên ngoài làm lệch tâm)
// cameraPos   : vị trí mắt camera (world space, sau khi env đã được đặt)
// cameraTarget: điểm camera nhìn vào
// modelPos    : vị trí đặt chân model
// modelRotY   : hướng xoay model (radian)

const ENV_CONFIG = {
  room1: {
    envScale:     45,
    centerOffset: { x: 0, z: 0 },
    cameraPos:    { x: 0,   y: 1.6, z:  2  },
    cameraTarget: { x: 0,   y: 1.2, z: -2  },
    modelPos:     { x: 0,   y: 0,   z: -3  },
    modelRotY:    0,
  },
  room2: {
    envScale:     25,
    centerOffset: { x: 0, z: 0 },
    cameraPos:    { x: 0,   y: 1.6, z:  2  },
    cameraTarget: { x: 0,   y: 1.2, z: -2  },
    modelPos:     { x: 0,   y: 0,   z:  0  },
    modelRotY:    0,
  },
  // room3: phòng triển lãm hình guitar
  // Bounding box của toàn bộ file bao gồm cả nền trắng rộng bên ngoài,
  // nên tâm bounding box KHÔNG phải tâm căn phòng.
  // → dùng centerOffset để dịch env sao cho phòng tròn lớn nằm quanh origin.
  // Cách tune: nếu camera vẫn nhìn ra ngoài, tăng/giảm centerOffset.x hoặc .z
  // cho đến khi tường phòng bao quanh camera từ mọi phía.
  room3: {
    envScale:     45,
    // Dịch env về phía âm X để phòng tròn lớn (bên trái trong layout)
    // trở thành trung tâm của scene
    centerOffset: { x: -8, z: 0 },
    cameraPos:    { x: -15, y: 1.6, z:  -10 },  // gần nhất: x: 15, y: 1.6, z:  5 
    cameraTarget: { x: -25, y: 1.4, z: 0 },  // gần nhất:  x: -25, y: 1.4, z: -3
    modelPos:     { x: -15, y: 0, z: 0 },  // x: -10, y: 0, z: 0
    modelRotY:    20                         // quay mặt về z+ (về phía camera)        
  },
}

function App() {
  const mountRef = useRef(null)
  const [activeModel, setActiveModel] = useState('default')
  const [activeEnv, setActiveEnv]     = useState('room1')
  const [envScaleUI, setEnvScaleUI]   = useState(25)

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
    let envZoom       = 25
    let lastEnvPath   = '/env/room1.glb'

    const loader = new GLTFLoader()
    const clock  = new THREE.Clock()

    // ================= MODEL =================
    function loadModel(path) {
      loader.load(path, (gltf) => {
        if (currentModel) scene.remove(currentModel)
        const model  = gltf.scene
        currentModel = model
        scene.add(model)

        const box  = new THREE.Box3().setFromObject(model)
        const size = box.getSize(new THREE.Vector3())
        model.scale.setScalar(2 / size.y)

        const cfg = ENV_CONFIG[currentEnvKey] || ENV_CONFIG['room1']
        model.position.set(cfg.modelPos.x, cfg.modelPos.y, cfg.modelPos.z)
        model.rotation.y = cfg.modelRotY ?? 0

        if (gltf.animations.length > 0) {
          mixer = new THREE.AnimationMixer(model)
          mixer.clipAction(gltf.animations[0]).play()
        }
      })
    }

    // ================= ENV =================
    function applyEnvConfig(cfg) {
      playerRig.position.set(0, 0, 0)
      camera.position.set(cfg.cameraPos.x,    cfg.cameraPos.y,    cfg.cameraPos.z)
      controls.target.set(cfg.cameraTarget.x, cfg.cameraTarget.y, cfg.cameraTarget.z)
      controls.update()

      if (currentModel) {
        currentModel.position.set(cfg.modelPos.x, cfg.modelPos.y, cfg.modelPos.z)
        currentModel.rotation.y = cfg.modelRotY ?? 0
      }
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

        // 1. Scale env
        const box  = new THREE.Box3().setFromObject(environment)
        const size = box.getSize(new THREE.Vector3())
        const envMaxHorizontal = Math.max(size.x, size.z)
        environment.scale.setScalar((2 * envZoom) / envMaxHorizontal)

        // 2. Căn giữa bounding box về origin
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

        // 3. Raycast tìm sàn thực tế tại vị trí camera sẽ đứng
        const rayOriginX = cfg.cameraPos.x
        const rayOriginZ = cfg.cameraPos.z
        const groundRay  = new THREE.Raycaster()
        groundRay.ray.origin.set(rayOriginX, 1000, rayOriginZ)
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
          const lookDir = new THREE.Vector3()
          xrCam.getWorldDirection(lookDir)
          lookDir.y = 0
          lookDir.normalize()

          const rightDir = new THREE.Vector3()
          rightDir.crossVectors(lookDir, new THREE.Vector3(0, 1, 0)).normalize()

          const speed = 3 * delta
          playerRig.position.addScaledVector(lookDir,  -stickY * speed)
          playerRig.position.addScaledVector(rightDir,  stickX * speed)
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
