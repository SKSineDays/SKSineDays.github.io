import * as THREE from '../assets/vendor/three-r180/three.module.min.js';
import { globePoints } from './globe-points.js';

export class EarthRenderer {
  constructor(host, { onUnavailable = () => {} } = {}) {
    this.host = host;
    this.onUnavailable = onUnavailable;
    this.destroyed = false;
    this.visible = false;
    this.rotating = false;
    this.frame = 0;
    this.lastTime = 0;
    this.slowFrames = 0;
    this.slowIntervals = 0;
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.abort = new AbortController();
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    const context = this.canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
    if (!context) throw new Error('WebGL 2 unavailable');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, context, alpha: true, antialias: true });
    this.renderer.setPixelRatio(this.dpr);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, .1, 20);
    this.camera.position.z = 3.65;
    this.tilt = new THREE.Group();
    this.tilt.rotation.z = -23.4 * Math.PI / 180;
    this.earth = new THREE.Group();
    this.earth.rotation.y = -.8;
    this.tilt.add(this.earth);
    this.scene.add(this.tilt);
    this.geometry = new THREE.SphereGeometry(1, 64, 40);
    this.material = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 7, specular: 0x183348 });
    this.earth.add(new THREE.Mesh(this.geometry, this.material));
    this.scene.add(new THREE.AmbientLight(0xa4b9dc, 1.05));
    const sunlight = new THREE.DirectionalLight(0xfff1de, 2.2);
    sunlight.position.set(-3, 2, 4);
    this.scene.add(sunlight);
    this.atmosphereMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide,
      uniforms: {},
      vertexShader: `varying vec3 n; varying vec3 v; void main(){ vec4 p=modelViewMatrix*vec4(position,1.); n=normalize(normalMatrix*normal); v=normalize(-p.xyz); gl_Position=projectionMatrix*p; }`,
      fragmentShader: `varying vec3 n; varying vec3 v; void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),3.); gl_FragColor=vec4(.18,.48,.85,rim*.38);}`
    });
    this.atmosphere = new THREE.Mesh(this.geometry, this.atmosphereMaterial);
    this.atmosphere.scale.setScalar(1.025);
    this.tilt.add(this.atmosphere);
    this.pointsGeometry = new THREE.BufferGeometry();
    this.pointsMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, depthTest: true,
      uniforms: { dpr: { value: this.dpr } },
      vertexShader: `attribute float size; uniform float dpr; void main(){ vec4 p=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*p; gl_PointSize=size*dpr; }`,
      fragmentShader: `void main(){ float d=length(gl_PointCoord-vec2(.5))*2.; if(d>1.) discard; float a=exp(-d*d*5.); gl_FragColor=vec4(1.,.88,.65,a); }`
    });
    this.points = new THREE.Points(this.pointsGeometry, this.pointsMaterial);
    this.points.frustumCulled = false;
    this.earth.add(this.points);
    this.setData([]);
    this.onContextLoss = event => {
      event.preventDefault();
      this.destroy();
      this.onUnavailable();
    };
    this.canvas.addEventListener('webglcontextlost', this.onContextLoss);
    host.append(this.canvas);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  async load() {
    const timeout = setTimeout(() => this.abort.abort(), 12000);
    try {
      const response = await fetch('/assets/globe/earth-july-2004.jpg', { signal: this.abort.signal });
      if (!response.ok) throw new Error('Earth texture unavailable');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        if (this.destroyed || this.abort.signal.aborted) throw new Error('Earth stopped');
        this.texture = new THREE.Texture(image);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
        this.texture.needsUpdate = true;
        this.material.map = this.texture;
        this.material.needsUpdate = true;
        this.ready = true;
        this.host.classList.add('is-earth-ready');
        this.draw();
      } finally { URL.revokeObjectURL(url); }
    } finally { clearTimeout(timeout); }
  }

  resize() {
    if (this.destroyed) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.draw();
  }

  setData(groups) {
    if (this.destroyed) return;
    const points = globePoints(groups);
    const previous = this.pointsGeometry;
    this.pointsGeometry = new THREE.BufferGeometry();
    this.points.geometry = this.pointsGeometry;
    previous.dispose();
    this.pointsGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points.flatMap(p => p.position), 3));
    this.pointsGeometry.setAttribute('size', new THREE.Float32BufferAttribute(points.map(p => p.size), 1));
    this.draw();
  }

  setState(visible, rotating) {
    if (this.destroyed) return;
    this.visible = visible;
    this.rotating = visible && rotating;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastTime = 0;
    if (visible) {
      this.resize();
      if (rotating) this.frame = requestAnimationFrame(time => this.tick(time));
    }
  }

  tick(time) {
    if (this.destroyed || !this.visible || !this.rotating) return;
    if (!this.lastTime) this.lastTime = time;
    const elapsed = time - this.lastTime;
    if (elapsed >= 1000 / 30 - 1) {
      this.earth.rotation.y += Math.min(elapsed, 100) * Math.PI * 2 / 110000;
      this.slowIntervals = elapsed > 50 ? this.slowIntervals + 1 : Math.max(0, this.slowIntervals - 1);
      if (this.slowIntervals > 60) this.lowerResolution();
      this.lastTime = time;
      this.draw();
    }
    this.frame = requestAnimationFrame(next => this.tick(next));
  }

  draw() {
    if (!this.ready || this.destroyed || !this.visible) return;
    const before = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.slowFrames = performance.now() - before > 18 ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 1);
    if (this.slowFrames > 60) this.lowerResolution();
  }

  lowerResolution() {
    if (this.dpr <= 1) return;
    this.dpr = 1;
    this.renderer.setPixelRatio(1);
    this.pointsMaterial.uniforms.dpr.value = 1;
    this.slowFrames = 0;
    this.slowIntervals = 0;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    cancelAnimationFrame(this.frame);
    this.abort.abort();
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.onContextLoss);
    this.texture?.dispose();
    this.geometry.dispose();
    this.material.dispose();
    this.atmosphereMaterial.dispose();
    this.pointsGeometry.dispose();
    this.pointsMaterial.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.host.classList.remove('is-earth-ready');
  }
}
