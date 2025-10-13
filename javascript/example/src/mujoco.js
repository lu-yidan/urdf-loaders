/* globals */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

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
const collisionToggle = document.getElementById('collision-toggle');
const radiansToggle = document.getElementById('radians-toggle');
const jointListEl = document.getElementById('joint-list');
let currentUrl = null;
let jointNameToGroup = new Map();
let jointAngles = new Map();
let jointNameToUI = new Map();

// Picking state
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let isDraggingJoint = false;
let activeJointName = null;
let lastPointer = { x: 0, y: 0 };

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

function shouldRenderGeom(geomEl) {
    // Heuristic: treat contype/conaffinity group flags as collision if nonzero
    const contype = geomEl.getAttribute('contype');
    const conaff = geomEl.getAttribute('conaffinity');
    // In MuJoCo defaults, if not specified: contype=1, conaffinity=1 (i.e., colliding)
    const unspecifiedMeansCollision = contype === null && conaff === null;
    const explicitCollision = (contype && contype !== '0') || (conaff && conaff !== '0');
    const isCollision = unspecifiedMeansCollision || explicitCollision;
    if (collisionToggle && !collisionToggle.classList.contains('checked') && isCollision) return false;
    return true;
}

function addGeom(parent, geomEl, extraRotationX = 0) {
    if (!shouldRenderGeom(geomEl)) return;
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

async function loadMuJoCoXml(url, { preserveView = false } = {}) {
    currentUrl = url;
    // Snapshot current camera state if we need to preserve
    const savedCamPos = camera.position.clone();
    const savedTarget = controls.target.clone();
    const savedQuat = camera.quaternion.clone();
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
    const angleUnit = (compiler?.getAttribute('angle') || 'degree').toLowerCase();
    const xmlAnglesAreRadians = angleUnit === 'radian';
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
    const objLoader = new OBJLoader(loaderManager);

    function addGeomWithAssets(parent, geomEl) {
        const type = geomEl.getAttribute('type') || 'box';
        if (type === 'mesh') {
            if (!shouldRenderGeom(geomEl)) return;
            const meshName = geomEl.getAttribute('mesh');
            const file = meshName ? assetMeshes.get(meshName) : null;
            if (file) {
                const fullPath = meshBase + file;
                const ext = fullPath.split('.').pop().toLowerCase();
                if (ext === 'stl') {
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
                } else if (ext === 'obj') {
                    objLoader.load(fullPath, object => {
                        // Apply a default material to OBJ if missing
                        object.traverse(c => {
                            if (c.isMesh && !c.material) c.material = makeMaterial(0xbdbdbd);
                        });
                        const pos = parseVec(geomEl.getAttribute('pos')) || [0, 0, 0];
                        const q = parseQuatWxyz(geomEl.getAttribute('quat'));
                        object.position.set(pos[0], pos[1], pos[2]);
                        if (q) object.quaternion.multiply(q);
                        if (flipToggle?.classList.contains('checked')) object.rotateX(Math.PI / 2);
                        parent.add(object);
                    });
                } else {
                    // Unsupported mesh type, fallback small box
                    addGeom(parent, geomEl, flipToggle?.classList.contains('checked') ? Math.PI / 2 : 0);
                }
                return;
            }
        }
        // Fallback to primitive handler
        addGeom(parent, geomEl, flipToggle?.classList.contains('checked') ? Math.PI / 2 : 0);
    }

    // Reset joint state/UI
    jointNameToGroup = new Map();
    jointAngles = new Map();
    if (jointListEl) jointListEl.innerHTML = '';

    // World geoms (e.g., floor)
    world.querySelectorAll(':scope > geom').forEach(geom => addGeomWithAssets(root, geom));
    // Bodies
    function buildBodyWithAssets(bodyEl) {
        const group = new THREE.Group();
        applyBodyTransform(group, bodyEl);

        // Build a chain of pivots if multiple joints exist on this body
        let attachParent = group;
        bodyEl.querySelectorAll(':scope > joint').forEach(jEl => {
            const jname = jEl.getAttribute('name') || '';
            const type = jEl.getAttribute('type') || 'hinge';
            const axis = parseVec(jEl.getAttribute('axis')) || [0, 0, 1];
            const rawRange = parseVec(jEl.getAttribute('range')) || null;
            let range = null;
            if (rawRange && rawRange.length >= 2) {
                if (xmlAnglesAreRadians) range = [parseFloat(rawRange[0]), parseFloat(rawRange[1])];
                else range = [parseFloat(rawRange[0]) * (Math.PI / 180), parseFloat(rawRange[1]) * (Math.PI / 180)];
            }
            const jpos = parseVec(jEl.getAttribute('pos')) || [0, 0, 0];

            // Create a pivot object for rotation/translation at joint position
            const pivot = new THREE.Group();
            pivot.position.set(jpos[0], jpos[1], jpos[2]);
            attachParent.add(pivot);
            jointNameToGroup.set(jname, { pivot, type, axis: new THREE.Vector3(axis[0], axis[1], axis[2]), range });
            jointAngles.set(jname, 0);

            // Visible handle to allow picking in the 3D view
            const handle = new THREE.Mesh(
                new THREE.SphereGeometry(0.02, 12, 12),
                new THREE.MeshBasicMaterial({ color: 0x00bcd4, transparent: true, opacity: 0.25 })
            );
            handle.userData.jointName = jname;
            pivot.add(handle);

            // Next elements attach after this joint
            attachParent = pivot;

            // Add UI row
            if (jointListEl && jname) {
                const li = document.createElement('li');
                li.setAttribute('joint-name', jname);
                li.innerHTML = `
                    <span title="${ jname }">${ jname }</span>
                    <input type="range" value="0" step="0.0001"/>
                    <input type="number" step="0.0001" />
                `;
                const slider = li.querySelector('input[type="range"]');
                const input = li.querySelector('input[type="number"]');

                const updateUIFromAngle = () => {
                    let angle = jointAngles.get(jname) || 0;
                    const useRad = radiansToggle && radiansToggle.classList.contains('checked');
                    const display = useRad ? angle : angle * (180 / Math.PI);
                    slider.value = angle;
                    input.value = display;
                    // Limits if provided (range already in radians)
                    if (range && type === 'hinge') {
                        const min = range[0];
                        const max = range[1];
                        slider.min = min;
                        slider.max = max;
                        if (!useRad) {
                            input.min = min * (180 / Math.PI);
                            input.max = max * (180 / Math.PI);
                        } else {
                            input.min = min;
                            input.max = max;
                        }
                    } else {
                        slider.min = -Math.PI;
                        slider.max = Math.PI;
                        if (!useRad) {
                            input.min = -180;
                            input.max = 180;
                        } else {
                            input.min = -Math.PI;
                            input.max = Math.PI;
                        }
                    }
                };

                slider.addEventListener('input', () => {
                    const angle = parseFloat(slider.value);
                    setJointValue(jname, angle);
                    updateUIFromAngle();
                });

                input.addEventListener('change', () => {
                    const useRad = radiansToggle && radiansToggle.classList.contains('checked');
                    const val = parseFloat(input.value);
                    const angle = useRad ? val : val * (Math.PI / 180);
                    setJointValue(jname, angle);
                    updateUIFromAngle();
                });

                jointListEl.appendChild(li);
                updateUIFromAngle();
                jointNameToUI.set(jname, { slider, input, updateUIFromAngle });
            }
        });
        // Attach geoms and children after the last joint pivot so they are affected by rotations
        bodyEl.querySelectorAll(':scope > geom').forEach(geom => addGeomWithAssets(attachParent, geom));
        bodyEl.querySelectorAll(':scope > body').forEach(child => {
            const childGroup = buildBodyWithAssets(child);
            attachParent.add(childGroup);
        });
        return group;
    }

    world.querySelectorAll(':scope > body').forEach(body => {
        const g = buildBodyWithAssets(body);
        root.add(g);
    });

    worldRoot.add(root);

    if (preserveView) {
        // Restore previous camera and target
        camera.position.copy(savedCamPos);
        camera.quaternion.copy(savedQuat);
        controls.target.copy(savedTarget);
        camera.updateProjectionMatrix();
        controls.update();
    } else {
        // Fit camera to new content
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
}

function setJointValue(name, angle) {
    const entry = jointNameToGroup.get(name);
    if (!entry) return;
    jointAngles.set(name, angle);
    if (entry.type === 'hinge') {
        // Rotate pivot about joint axis in local space
        const { pivot, axis } = entry;
        const q = new THREE.Quaternion().setFromAxisAngle(axis.clone().normalize(), angle);
        pivot.setRotationFromQuaternion(q);
    }
    const ui = jointNameToUI.get(name);
    if (ui) ui.updateUIFromAngle();
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
        if (currentUrl) loadMuJoCoXml(currentUrl, { preserveView: true }).catch(err => console.error(err));
    });
}

if (collisionToggle) {
    collisionToggle.addEventListener('click', () => {
        collisionToggle.classList.toggle('checked');
        if (currentUrl) loadMuJoCoXml(currentUrl, { preserveView: true }).catch(err => console.error(err));
    });
}

if (radiansToggle) {
    radiansToggle.addEventListener('click', () => {
        radiansToggle.classList.toggle('checked');
        // Refresh joint number inputs to convert between deg/rad
        jointListEl?.querySelectorAll('li[joint-name]')?.forEach(li => {
            const name = li.getAttribute('joint-name');
            const slider = li.querySelector('input[type="range"]');
            const input = li.querySelector('input[type="number"]');
            const angle = jointAngles.get(name) || 0;
            const useRad = radiansToggle.classList.contains('checked');
            input.value = useRad ? angle : angle * (180 / Math.PI);
        });
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



// 3D joint dragging: click a joint handle, drag left/right to change angle
function onPointerMove(event) {
    lastPointer.x = event.clientX;
    lastPointer.y = event.clientY;
    if (isDraggingJoint && activeJointName) {
        // Horizontal delta controls angle change
        const delta = (event.movementX || 0) * 0.01; // sensitivity
        const current = jointAngles.get(activeJointName) || 0;
        setJointValue(activeJointName, current + delta);
    }
}

function onPointerDown(event) {
    pointer.x = (event.clientX / renderer.domElement.clientWidth) * 2 - 1;
    pointer.y = -(event.clientY / renderer.domElement.clientHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(worldRoot, true);
    const hit = intersects.find(i => i.object.userData && i.object.userData.jointName);
    if (hit) {
        isDraggingJoint = true;
        activeJointName = hit.object.userData.jointName;
        renderer.domElement.style.cursor = 'grabbing';
        controls.enabled = false;
    }
}

function onPointerUp() {
    isDraggingJoint = false;
    activeJointName = null;
    renderer.domElement.style.cursor = '';
    controls.enabled = true;
}

renderer.domElement.addEventListener('pointermove', onPointerMove);
renderer.domElement.addEventListener('pointerdown', onPointerDown);
renderer.domElement.addEventListener('pointerup', onPointerUp);
renderer.domElement.addEventListener('mouseleave', onPointerUp);

