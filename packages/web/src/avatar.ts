import * as THREE from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm"
import { NO_VISEMES, type Visemes } from "./lipsync.js"

/** VRM avatar in a three.js scene. Mouth shapes come from `setVisemes`, driven by played audio. */
export class Avatar {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 20)
  private vrm: VRM | undefined
  private visemes: Visemes = NO_VISEMES
  private blinkIn = 2
  private blinkT = -1
  private clock = 0
  /** Largest total mouth opening seen since `resetPeak()`; used by the browser proof. */
  peakMouth = 0

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    container.prepend(this.renderer.domElement)
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6))
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(1, 2, 2); this.scene.add(key)
    new ResizeObserver(() => this.resize()).observe(container)
    this.resize()
  }

  get loaded(): boolean { return this.vrm !== undefined }
  get mouth(): Visemes { return this.visemes }
  resetPeak(): void { this.peakMouth = 0 }

  async load(url: string): Promise<void> {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))
    const gltf = await loader.loadAsync(url)
    const vrm = gltf.userData["vrm"] as VRM
    VRMUtils.rotateVRM0(vrm)
    this.scene.add(vrm.scene)
    this.vrm = vrm
    const h = vrm.humanoid
    h.getNormalizedBoneNode("leftUpperArm")?.rotation.set(0, 0, -1.15)
    h.getNormalizedBoneNode("rightUpperArm")?.rotation.set(0, 0, 1.15)
    const head = h.getNormalizedBoneNode("head")!.getWorldPosition(new THREE.Vector3())
    this.camera.position.set(head.x, head.y + 0.0, head.z + 1.7)
    this.camera.lookAt(head.x, head.y - 0.14, head.z)
  }

  setVisemes(v: Visemes): void {
    this.visemes = v
    this.peakMouth = Math.max(this.peakMouth, v.aa + v.ih + v.ou + v.ee + v.oh)
  }

  update(dt: number): void {
    this.clock += dt
    const vrm = this.vrm
    if (vrm) {
      const em = vrm.expressionManager
      if (em) {
        em.setValue("aa", this.visemes.aa); em.setValue("ih", this.visemes.ih); em.setValue("ou", this.visemes.ou)
        em.setValue("ee", this.visemes.ee); em.setValue("oh", this.visemes.oh)
        this.blinkIn -= dt
        if (this.blinkIn <= 0 && this.blinkT < 0) { this.blinkT = 0; this.blinkIn = 2.5 + Math.random() * 3.5 }
        if (this.blinkT >= 0) {
          this.blinkT += dt
          em.setValue("blink", Math.sin(Math.min(1, this.blinkT / 0.16) * Math.PI))
          if (this.blinkT > 0.16) { this.blinkT = -1; em.setValue("blink", 0) }
        }
      }
      const spine = vrm.humanoid.getNormalizedBoneNode("spine")
      if (spine) spine.rotation.x = Math.sin(this.clock * 1.4) * 0.012
      vrm.update(dt)
    }
    this.renderer.render(this.scene, this.camera)
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
  }
}
