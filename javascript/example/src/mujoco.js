/* globals */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

const rootEl = document.getElementById('viewer-root');

// Scene setup
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
rootEl.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111111);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 1000);
camera.position.set(3, 2, 3);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.update();

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const dir = new THREE.DirectionalLight(0xffffff, 0.8);
dir.position.set(5, 10, 4);
scene.add(dir);

// Ground grid
const grid = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
grid.material.opacity = 0.3;
grid.material.transparent = true;
scene.add(grid);

// Root transform: MuJoCo is z-up; Three.js is y-up. Rotate -90° about X so z->y
const worldRoot = new THREE.Group();
worldRoot.rotation.x = -Math.PI / 2;
scene.add(worldRoot);

// UI elements
const flipToggle = document.getElementById('flip-visual');
let currentUrl = null;

// Helpers
function parseVec(str, expected) {
    if (!str) return null;
    const nums = str.trim().split(/\s+/).map(parseFloat).filter(n => !Number.isNaN(n));
    if (expected && nums.length !== expected) return null;
    return nums;
}

function parseQuatWxyz(str) {
    // MuJoCo quaternions are w x y z
    const q = parseVec(str);
    if (!q || q.length !== 4) return null;
    return new THREE.Quaternion(q[1], q[2], q[3], q[0]);
}

function applyBodyTransform(object3d, bodyEl) {
    const pos = parseVec(bodyEl.getAttribute('pos'));
    if (pos) object3d.position.set(pos[0], pos[1], pos[2]);
    const quat = parseQuatWxyz(bodyEl.getAttribute('quat'));
    if (quat) object3d.quaternion.multiply(quat);
}

function makeMaterial(hex) {
    return new THREE.MeshStandardMaterial({ color: hex || 0x9db1cc, roughness: 0.6, metalness: 0.0 });
}

function addGeom(parent, geomEl, extraRotationX = 0) {
    const type = geomEl.getAttribute('type') || 'box';
    const fromto = parseVec(geomEl.getAttribute('fromto'));
    const size = parseVec(geomEl.getAttribute('size'));
    const pos = parseVec(geomEl.getAttribute('pos')) || [0, 0, 0];
    const q = parseQuatWxyz(geomEl.getAttribute('quat'));

    let mesh = null;
    if (type === 'sphere') {
        const r = size ? size[0] : 0.1;
        const geo = new THREE.SphereGeometry(r, 24, 16);
        mesh = new THREE.Mesh(geo, makeMaterial());
        mesh.position.set(pos[0], pos[1], pos[2]);
    } else if (type === 'capsule') {
        // Use fromto endpoints and size[0] as radius
        if (fromto && size && size[0] > 0) {
            const ax = new THREE.Vector3(fromto[0], fromto[1], fromto[2]);
            const bx = new THREE.Vector3(fromto[3], fromto[4], fromto[5]);
            const radius = size[0];
            const axis = new THREE.Vector3().subVectors(bx, ax);
            const length = axis.length();
            const center = new THREE.Vector3().addVectors(ax, bx).multiplyScalar(0.5);

            // CapsuleGeometry(radius, length without caps, capSegments, radialSegments)
            const straightLen = Math.max(0.0, length - 2 * radius);
            const geo = new THREE.CapsuleGeometry(radius, straightLen, 8, 16);
            mesh = new THREE.Mesh(geo, makeMaterial());

            // Orient capsule to align with axis
            mesh.position.copy(center);
            const up = new THREE.Vector3(0, 1, 0);
            const quat = new THREE.Quaternion().setFromUnitVectors(up, axis.clone().normalize());
            mesh.quaternion.copy(quat);
        }
    } else if (type === 'box') {
        // MuJoCo size for box are half-sizes (hx hy hz)
        const hx = size ? size[0] : 0.05;
        const hy = size ? (size[1] ?? hx) : hx;
        const hz = size ? (size[2] ?? hx) : hy;
        const geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
        mesh = new THREE.Mesh(geo, makeMaterial());
        mesh.position.set(pos[0], pos[1], pos[2]);
    } else {
        // Fallback: small box
        const geo = new THREE.BoxGeometry(0.05, 0.05, 0.05);
        mesh = new THREE.Mesh(geo, makeMaterial(0xff7043));
    }

    if (!mesh) return;
    if (q) mesh.quaternion.multiply(q);
    if (extraRotationX) mesh.rotateX(extraRotationX);
    parent.add(mesh);
}

function buildBody(bodyEl) {
    const group = new THREE.Group();
    applyBodyTransform(group, bodyEl);

    // Geoms directly under this body
    bodyEl.querySelectorAll(':scope > geom').forEach(geom => addGeom(group, geom));

    // Recurse into children bodies
    bodyEl.querySelectorAll(':scope > body').forEach(child => {
        const childGroup = buildBody(child);
        group.add(childGroup);
    });

    return group;
}

async function loadMuJoCoXml(url) {
    currentUrl = url;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('XML parse error');

    const world = doc.querySelector('mujoco > worldbody');
    if (!world) throw new Error('No worldbody element');

    // Resolve mesh base path from compiler meshdir and XML url
    const compiler = doc.querySelector('mujoco > compiler');
    const meshdir = compiler?.getAttribute('meshdir') || '';
    const urlObj = new URL(url, window.location.origin);
    const xmlDir = urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1);
    const meshBase = (xmlDir + meshdir).replace(/\/+$/, '/')
        .replace(/\/+/g, '/');

    // Asset meshes map name->file
    const assetMeshes = new Map();
    doc.querySelectorAll('mujoco > asset > mesh[name][file]')
        .forEach(m => assetMeshes.set(m.getAttribute('name'), m.getAttribute('file')));

    // Clear previous
    const previous = worldRoot.getObjectByName('mj-root');
    if (previous) worldRoot.remove(previous);

    const root = new THREE.Group();
    root.name = 'mj-root';

    // Extend addGeom to handle mesh types using STLLoader
    const loaderManager = new THREE.LoadingManager();
    const stlLoader = new STLLoader(loaderManager);

    function addGeomWithAssets(parent, geomEl) {
        const type = geomEl.getAttribute('type') || 'box';
        if (type === 'mesh') {
            const meshName = geomEl.getAttribute('mesh');
            const file = meshName ? assetMeshes.get(meshName) : null;
            if (file) {
                const fullPath = meshBase + file;
                stlLoader.load(fullPath, geometry => {
                    geometry.computeVertexNormals();
                    const mesh = new THREE.Mesh(geometry, makeMaterial(0xbdbdbd));
                    const pos = parseVec(geomEl.getAttribute('pos')) || [0, 0, 0];
                    const q = parseQuatWxyz(geomEl.getAttribute('quat'));
                    mesh.position.set(pos[0], pos[1], pos[2]);
                    if (q) mesh.quaternion.multiply(q);
                    if (flipToggle?.classList.contains('checked')) mesh.rotateX(Math.PI / 2);
                    parent.add(mesh);
                });
                return;
            }
        }
        // Fallback to primitive handler
        addGeom(parent, geomEl, flipToggle?.classList.contains('checked') ? Math.PI / 2 : 0);
    }

    // World geoms (e.g., floor)
    world.querySelectorAll(':scope > geom').forEach(geom => addGeomWithAssets(root, geom));
    // Bodies
    function buildBodyWithAssets(bodyEl) {
        const group = new THREE.Group();
        applyBodyTransform(group, bodyEl);
        bodyEl.querySelectorAll(':scope > geom').forEach(geom => addGeomWithAssets(group, geom));
        bodyEl.querySelectorAll(':scope > body').forEach(child => {
            const childGroup = buildBodyWithAssets(child);
            group.add(childGroup);
        });
        return group;
    }

    world.querySelectorAll(':scope > body').forEach(body => {
        const g = buildBodyWithAssets(body);
        root.add(g);
    });

    worldRoot.add(root);

    // Fit camera
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const center = new THREE.Vector3();
    box.getCenter(center);
    controls.target.copy(center);
    const radius = Math.max(size.x, size.y, size.z) * 0.6 + 0.5;
    camera.position.copy(center.clone().add(new THREE.Vector3(radius, radius, radius)));
    camera.near = Math.max(0.01, radius / 100);
    camera.far = radius * 100;
    camera.updateProjectionMatrix();
    controls.update();
}

// Load default model from absolute path under repo root served by static-server
const defaultUrl = '/mujoco/humanoid.xml';
loadMuJoCoXml(defaultUrl).catch(err => {
    console.error('Failed to load MuJoCo XML:', err);
});

// Menu hookup (if multiple XMLs are added later)
document.querySelectorAll('#mj-options li[data-xml]').forEach(li => {
    li.addEventListener('click', () => {
        const url = li.getAttribute('data-xml');
        loadMuJoCoXml(url).catch(err => console.error(err));
    });
});

// Flip toggle wiring: toggle class and reload current model
if (flipToggle) {
    flipToggle.addEventListener('click', () => {
        flipToggle.classList.toggle('checked');
        if (currentUrl) loadMuJoCoXml(currentUrl).catch(err => console.error(err));
    });
}

// Resize handling
function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// Render loop
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();


