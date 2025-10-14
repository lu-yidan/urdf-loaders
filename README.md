# urdf-loaders

URDF loading code in both [C# for Unity](./unity/Assets/URDFLoader/) and [Javascript for THREE.js](./javascript/), as well as example [JPL ATHLETE](https://en.wikipedia.org/wiki/ATHLETE) URDF files

[Demo Here!](https://gkjohnson.github.io/urdf-loaders/javascript/example/bundle/)

![Example](./unity/Assets/docs/asset%20store/all-urdfs.png)

### Flipped Models

The `_flipped` variants of the URDF ATHLETE models invert the revolute joint axes to model ATHLETE in a configuration with the legs attached to the bottom of the chassis.

## MuJoCo XML Viewer (Extended)

This repository now includes an extended web viewer that supports loading and visualizing MuJoCo XML models in addition to URDF. It lives under `javascript/example/mujoco.html` and comes with drag‑and‑drop support for local MuJoCo model folders.

See the usage and deployment guide:

- [`javascript/example/README.mujoco.md`](./javascript/example/README.mujoco.md)

Live demo:

- [mujoco-viewer.org](https://mujoco-viewer.org)

# LICENSE

The software is available under the [Apache V2.0 license](./LICENSE).

Copyright © 2020 California Institute of Technology. ALL RIGHTS
RESERVED. United States Government Sponsorship Acknowledged.
Neither the name of Caltech nor its operating division, the
Jet Propulsion Laboratory, nor the names of its contributors may be
used to endorse or promote products derived from this software
without specific prior written permission.
