// @ts-nocheck
// Borrowed from the orbit controls example in three.js
// https://github.com/mrdoob/three.js
// Copyright (c) 2010-2023 three.js authors
// Licensed under the MIT license

import * as THREE from 'three';
import { EventDispatcher, MathUtils } from 'three';

const STATE = {
  NONE: -1,
  ROTATE: 0,
  DOLLY: 1,
  PAN: 2,
  TOUCH_ROTATE: 3,
  TOUCH_PAN: 4,
  TOUCH_DOLLY_PAN: 5,
  TOUCH_DOLLY_ROTATE: 6,
};

const _changeEvent = { type: 'change' };
const _startEvent = { type: 'start' };
const _endEvent = { type: 'end' };
const _ray = new THREE.Ray();
const _plane = new THREE.Plane();

const TILT_LIMIT = Math.cos(70 * MathUtils.DEG2RAD);
const EPS = 0.000001;
const TWO_PI = 2 * Math.PI;

class BaseOrbitControls extends EventDispatcher<any> {
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
  domElement: HTMLElement;

  // Set to false to disable this control
  enabled = true;

  // "target" sets the location of focus, where the object orbits around
  target = new THREE.Vector3();

  // Sets the 3D cursor (similar to Blender), from which the maxTargetRadius takes effect
  cursor = new THREE.Vector3();

  // How far you can dolly in and out ( PerspectiveCamera only )
  minDistance = 0;
  maxDistance = Infinity;

  // How far you can zoom in and out ( OrthographicCamera only )
  minZoom = 0;
  maxZoom = Infinity;

  // Limit camera target within a spherical area around the cursor
  minTargetRadius = 0;
  maxTargetRadius = Infinity;

  // How far you can orbit vertically, upper and lower limits.
  // Range is 0 to Math.PI radians.
  minPolarAngle = 0; // radians
  maxPolarAngle = Math.PI; // radians

  // How far you can orbit horizontally, upper and lower limits.
  // If set, the interval [ min, max ] must be a sub-interval of [ - 2 PI, 2 PI ], with ( max - min < 2 PI )
  minAzimuthAngle = -Infinity; // radians
  maxAzimuthAngle = Infinity; // radians

  // Set to true to enable damping (inertia)
  // If damping is enabled, you must call controls.update() in your animation loop
  enableDamping = false;
  dampingFactor = 0.05;

  // This option actually enables dollying in and out; left as "zoom" for backwards compatibility.
  // Set to false to disable zooming
  enableZoom = true;
  zoomSpeed = 1.0;

  // Set to false to disable rotating
  enableRotate = true;
  rotateSpeed = 1.0;

  // Set to false to disable panning
  enablePan = true;
  panSpeed = 1.0;
  screenSpacePanning = true; // if false, pan orthogonal to world-space direction camera.up
  keyPanSpeed = 7.0; // pixels moved per arrow key push
  zoomToCursor = false;

  // Set to true to automatically rotate around the target
  // If auto-rotate is enabled, you must call controls.update() in your animation loop
  autoRotate = false;
  autoRotateSpeed = 2.0; // 30 seconds per orbit when fps is 60

  // The four arrow keys
  keys = { LEFT: 'ArrowLeft', UP: 'ArrowUp', RIGHT: 'ArrowRight', BOTTOM: 'ArrowDown' };

  // Mouse buttons
  mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  // Touch fingers
  touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  #state = STATE.NONE;

  #offset = new THREE.Vector3();

  #quat: THREE.Quaternion;
  #quatInverse: THREE.Quaternion;

  #lastPosition = new THREE.Vector3();
  #lastQuaternion = new THREE.Quaternion();
  #lastTargetPosition = new THREE.Vector3();

  // current position in spherical coordinates
  #spherical = new THREE.Spherical();
  #sphericalDelta = new THREE.Spherical();

  #scale = 1;
  #panOffset = new THREE.Vector3();

  #rotateStart = new THREE.Vector2();
  #rotateEnd = new THREE.Vector2();
  #rotateDelta = new THREE.Vector2();

  #panStart = new THREE.Vector2();
  #panEnd = new THREE.Vector2();
  #panDelta = new THREE.Vector2();

  #dollyStart = new THREE.Vector2();
  #dollyEnd = new THREE.Vector2();
  #dollyDelta = new THREE.Vector2();

  #dollyDirection = new THREE.Vector3();
  #mouse = new THREE.Vector2();
  #performCursorZoom = false;

  #pointers = [];
  #pointerPositions = {};

  #v = new THREE.Vector3();

  #target0: THREE.Vector3;
  #position0: THREE.Vector3;
  #zoom0: number;

  // the target DOM element for key events
  #domElementKeyEvents: HTMLElement = null;

  constructor(camera: THREE.OrthographicCamera | THREE.PerspectiveCamera, domElement: HTMLElement) {
    super();

    this.camera = camera;
    this.domElement = domElement;
    this.domElement.style.touchAction = 'none'; // disable touch scroll

    // for reset
    this.#target0 = this.target.clone();
    this.#position0 = this.camera.position.clone();
    this.#zoom0 = this.camera.zoom;

    // so camera.up is the orbit axis
    this.#quat = new THREE.Quaternion().setFromUnitVectors(
      this.camera.up,
      new THREE.Vector3(0, 1, 0),
    );
    this.#quatInverse = this.#quat.clone().invert();

    this.domElement.addEventListener('contextmenu', this.#onContextMenu);

    this.domElement.addEventListener('pointerdown', this.#onPointerDown);
    this.domElement.addEventListener('pointercancel', this.#onPointerUp);
    this.domElement.addEventListener('wheel', this.#onMouseWheel, { passive: false });
  }

  getPolarAngle() {
    return this.#spherical.phi;
  }

  getAzimuthalAngle() {
    return this.#spherical.theta;
  }

  getDistance() {
    return this.camera.position.distanceTo(this.target);
  }

  listenToKeyEvents(domElement: HTMLElement) {
    domElement.addEventListener('keydown', this.#onKeyDown);
    this.#domElementKeyEvents = domElement;
  }

  stopListenToKeyEvents() {
    this.#domElementKeyEvents.removeEventListener('keydown', this.#onKeyDown);
    this.#domElementKeyEvents = null;
  }

  saveState() {
    this.#target0.copy(this.target);
    this.#position0.copy(this.camera.position);
    this.#zoom0 = this.camera.zoom;
  }

  reset() {
    this.target.copy(this.#target0);
    this.camera.position.copy(this.#position0);
    this.camera.zoom = this.#zoom0;

    this.camera.updateProjectionMatrix();
    this.dispatchEvent(_changeEvent);

    this.update();

    this.#state = STATE.NONE;
  }

  // this method is exposed, but perhaps it would be better if we can make it private...
  update(deltaTime: number = null) {
    const position = this.camera.position;

    this.#offset.copy(position).sub(this.target);

    // rotate offset to "y-axis-is-up" space
    this.#offset.applyQuaternion(this.#quat);

    // angle from z-axis around y-axis
    this.#spherical.setFromVector3(this.#offset);

    if (this.autoRotate && this.#state === STATE.NONE) {
      this.#rotateLeft(this.#getAutoRotationAngle(deltaTime));
    }

    if (this.enableDamping) {
      this.#spherical.theta += this.#sphericalDelta.theta * this.dampingFactor;
      this.#spherical.phi += this.#sphericalDelta.phi * this.dampingFactor;
    } else {
      this.#spherical.theta += this.#sphericalDelta.theta;
      this.#spherical.phi += this.#sphericalDelta.phi;
    }

    // restrict theta to be between desired limits

    let min = this.minAzimuthAngle;
    let max = this.maxAzimuthAngle;

    if (isFinite(min) && isFinite(max)) {
      if (min < -Math.PI) {
        min += TWO_PI;
      } else if (min > Math.PI) {
        min -= TWO_PI;
      }

      if (max < -Math.PI) {
        max += TWO_PI;
      } else if (max > Math.PI) {
        max -= TWO_PI;
      }

      if (min <= max) {
        this.#spherical.theta = Math.max(min, Math.min(max, this.#spherical.theta));
      } else {
        this.#spherical.theta =
          this.#spherical.theta > (min + max) / 2
            ? Math.max(min, this.#spherical.theta)
            : Math.min(max, this.#spherical.theta);
      }
    }

    // restrict phi to be between desired limits
    this.#spherical.phi = Math.max(
      this.minPolarAngle,
      Math.min(this.maxPolarAngle, this.#spherical.phi),
    );

    this.#spherical.makeSafe();

    // move target to panned location

    if (this.enableDamping === true) {
      this.target.addScaledVector(this.#panOffset, this.dampingFactor);
    } else {
      this.target.add(this.#panOffset);
    }

    // Limit the target distance from the cursor to create a sphere around the center of interest
    this.target.sub(this.cursor);
    this.target.clampLength(this.minTargetRadius, this.maxTargetRadius);
    this.target.add(this.cursor);

    // adjust the camera position based on zoom only if we're not zooming to the cursor or if it's an ortho camera
    // we adjust zoom later in these cases
    if (
      (this.zoomToCursor && this.#performCursorZoom) ||
      this.camera instanceof THREE.OrthographicCamera
    ) {
      this.#spherical.radius = this.#clampDistance(this.#spherical.radius);
    } else {
      this.#spherical.radius = this.#clampDistance(this.#spherical.radius * this.#scale);
    }

    this.#offset.setFromSpherical(this.#spherical);

    // rotate offset back to "camera-up-vector-is-up" space
    this.#offset.applyQuaternion(this.#quatInverse);

    position.copy(this.target).add(this.#offset);

    this.camera.lookAt(this.target);

    if (this.enableDamping === true) {
      this.#sphericalDelta.theta *= 1 - this.dampingFactor;
      this.#sphericalDelta.phi *= 1 - this.dampingFactor;

      this.#panOffset.multiplyScalar(1 - this.dampingFactor);
    } else {
      this.#sphericalDelta.set(0, 0, 0);

      this.#panOffset.set(0, 0, 0);
    }

    // adjust camera position
    let zoomChanged = false;
    if (this.zoomToCursor && this.#performCursorZoom) {
      let newRadius = null;
      if (this.camera instanceof THREE.PerspectiveCamera) {
        // move the camera down the pointer ray
        // this method avoids floating point error
        const prevRadius = this.#offset.length();
        newRadius = this.#clampDistance(prevRadius * this.#scale);

        const radiusDelta = prevRadius - newRadius;
        this.camera.position.addScaledVector(this.#dollyDirection, radiusDelta);
        this.camera.updateMatrixWorld();
      } else if (this.camera instanceof THREE.OrthographicCamera) {
        // adjust the ortho camera position based on zoom changes
        const mouseBefore = new THREE.Vector3(this.#mouse.x, this.#mouse.y, 0);
        mouseBefore.unproject(this.camera);

        this.camera.zoom = Math.max(
          this.minZoom,
          Math.min(this.maxZoom, this.camera.zoom / this.#scale),
        );
        this.camera.updateProjectionMatrix();
        zoomChanged = true;

        const mouseAfter = new THREE.Vector3(this.#mouse.x, this.#mouse.y, 0);
        mouseAfter.unproject(this.camera);

        this.camera.position.sub(mouseAfter).add(mouseBefore);
        this.camera.updateMatrixWorld();

        newRadius = this.#offset.length();
      } else {
        console.warn(
          'WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled.',
        );
        this.zoomToCursor = false;
      }

      // handle the placement of the target
      if (newRadius !== null) {
        if (this.screenSpacePanning) {
          // position the orbit target in front of the new camera position
          this.target
            .set(0, 0, -1)
            .transformDirection(this.camera.matrix)
            .multiplyScalar(newRadius)
            .add(this.camera.position);
        } else {
          // get the ray and translation plane to compute target
          _ray.origin.copy(this.camera.position);
          _ray.direction.set(0, 0, -1).transformDirection(this.camera.matrix);

          // if the camera is 20 degrees above the horizon then don't adjust the focus target to avoid
          // extremely large values
          if (Math.abs(this.camera.up.dot(_ray.direction)) < TILT_LIMIT) {
            this.camera.lookAt(this.target);
          } else {
            _plane.setFromNormalAndCoplanarPoint(this.camera.up, this.target);
            _ray.intersectPlane(_plane, this.target);
          }
        }
      }
    } else if (this.camera instanceof THREE.OrthographicCamera) {
      this.camera.zoom = Math.max(
        this.minZoom,
        Math.min(this.maxZoom, this.camera.zoom / this.#scale),
      );
      this.camera.updateProjectionMatrix();
      zoomChanged = true;
    }

    this.#scale = 1;
    this.#performCursorZoom = false;

    // update condition is:
    // min(camera displacement, camera rotation in radians)^2 > EPS
    // using small-angle approximation cos(x/2) = 1 - x^2 / 8

    if (
      zoomChanged ||
      this.#lastPosition.distanceToSquared(this.camera.position) > EPS ||
      8 * (1 - this.#lastQuaternion.dot(this.camera.quaternion)) > EPS ||
      this.#lastTargetPosition.distanceToSquared(this.target) > 0
    ) {
      this.dispatchEvent(_changeEvent);

      this.#lastPosition.copy(this.camera.position);
      this.#lastQuaternion.copy(this.camera.quaternion);
      this.#lastTargetPosition.copy(this.target);

      return true;
    }

    return false;
  }

  dispose() {
    this.domElement.removeEventListener('contextmenu', this.#onContextMenu);

    this.domElement.removeEventListener('pointerdown', this.#onPointerDown);
    this.domElement.removeEventListener('pointercancel', this.#onPointerUp);
    this.domElement.removeEventListener('wheel', this.#onMouseWheel);

    this.domElement.removeEventListener('pointermove', this.#onPointerMove);
    this.domElement.removeEventListener('pointerup', this.#onPointerUp);

    if (this.#domElementKeyEvents !== null) {
      this.#domElementKeyEvents.removeEventListener('keydown', this.#onKeyDown);
      this.#domElementKeyEvents = null;
    }

    //this.dispatchEvent( { type: 'dispose' } ); // should this be added here?
  }

  #getAutoRotationAngle(deltaTime: number) {
    if (deltaTime !== null) {
      return (TWO_PI / 60) * this.autoRotateSpeed * deltaTime;
    } else {
      return (TWO_PI / 60 / 60) * this.autoRotateSpeed;
    }
  }

  #getZoomScale(delta: number) {
    const normalized_delta = Math.abs(delta) / (100 * (window.devicePixelRatio | 0));
    return Math.pow(0.95, this.zoomSpeed * normalized_delta);
  }

  #rotateLeft(angle: number) {
    this.#sphericalDelta.theta -= angle;
  }

  #rotateUp(angle: number) {
    this.#sphericalDelta.phi -= angle;
  }

  #panLeft(distance: number, objectMatrix: THREE.Matrix4) {
    this.#v.setFromMatrixColumn(objectMatrix, 0); // get X column of objectMatrix
    this.#v.multiplyScalar(-distance);

    this.#panOffset.add(this.#v);
  }

  #panUp(distance: number, objectMatrix: THREE.Matrix4) {
    if (this.screenSpacePanning === true) {
      this.#v.setFromMatrixColumn(objectMatrix, 1);
    } else {
      this.#v.setFromMatrixColumn(objectMatrix, 0);
      this.#v.crossVectors(this.camera.up, this.#v);
    }

    this.#v.multiplyScalar(distance);

    this.#panOffset.add(this.#v);
  }

  #pan(deltaX: number, deltaY: number) {
    const element = this.domElement;

    if (this.camera instanceof THREE.PerspectiveCamera) {
      // perspective
      const position = this.camera.position;
      this.#offset.copy(position).sub(this.target);
      let targetDistance = this.#offset.length();

      // half of the fov is center to top of screen
      targetDistance *= Math.tan(((this.camera.fov / 2) * Math.PI) / 180.0);

      // we use only clientHeight here so aspect ratio does not distort speed
      this.#panLeft((2 * deltaX * targetDistance) / element.clientHeight, this.camera.matrix);
      this.#panUp((2 * deltaY * targetDistance) / element.clientHeight, this.camera.matrix);
    } else if (this.camera instanceof THREE.OrthographicCamera) {
      // orthographic
      this.#panLeft(
        (deltaX * (this.camera.right - this.camera.left)) / this.camera.zoom / element.clientWidth,
        this.camera.matrix,
      );
      this.#panUp(
        (deltaY * (this.camera.top - this.camera.bottom)) / this.camera.zoom / element.clientHeight,
        this.camera.matrix,
      );
    } else {
      // camera neither orthographic nor perspective
      console.warn('WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.');
      this.enablePan = false;
    }
  }

  #dollyOut(dollyScale: number) {
    if (
      this.camera instanceof THREE.PerspectiveCamera ||
      this.camera instanceof THREE.OrthographicCamera
    ) {
      this.#scale /= dollyScale;
    } else {
      console.warn(
        'WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.',
      );
      this.enableZoom = false;
    }
  }

  #dollyIn(dollyScale: number) {
    if (
      this.camera instanceof THREE.PerspectiveCamera ||
      this.camera instanceof THREE.OrthographicCamera
    ) {
      this.#scale *= dollyScale;
    } else {
      console.warn(
        'WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.',
      );
      this.enableZoom = false;
    }
  }

  #updateZoomParameters(x: number, y: number) {
    if (!this.zoomToCursor) {
      return;
    }

    this.#performCursorZoom = true;

    const rect = this.domElement.getBoundingClientRect();
    const dx = x - rect.left;
    const dy = y - rect.top;
    const w = rect.width;
    const h = rect.height;

    this.#mouse.x = (dx / w) * 2 - 1;
    this.#mouse.y = -(dy / h) * 2 + 1;

    this.#dollyDirection
      .set(this.#mouse.x, this.#mouse.y, 1)
      .unproject(this.camera)
      .sub(this.camera.position)
      .normalize();
  }

  #clampDistance(dist: number) {
    return Math.max(this.minDistance, Math.min(this.maxDistance, dist));
  }

  #handleMouseDownRotate(event: MouseEvent) {
    this.#rotateStart.set(event.clientX, event.clientY);
  }

  #handleMouseDownDolly(event: MouseEvent) {
    this.#updateZoomParameters(event.clientX, event.clientX);
    this.#dollyStart.set(event.clientX, event.clientY);
  }

  #handleMouseDownPan(event: MouseEvent) {
    this.#panStart.set(event.clientX, event.clientY);
  }

  #handleMouseMoveRotate(event: MouseEvent) {
    this.#rotateEnd.set(event.clientX, event.clientY);

    this.#rotateDelta
      .subVectors(this.#rotateEnd, this.#rotateStart)
      .multiplyScalar(this.rotateSpeed);

    const element = this.domElement;

    this.#rotateLeft((TWO_PI * this.#rotateDelta.x) / element.clientHeight); // yes, height

    this.#rotateUp((TWO_PI * this.#rotateDelta.y) / element.clientHeight);

    this.#rotateStart.copy(this.#rotateEnd);

    this.update();
  }

  #handleMouseMoveDolly(event: MouseEvent) {
    this.#dollyEnd.set(event.clientX, event.clientY);

    this.#dollyDelta.subVectors(this.#dollyEnd, this.#dollyStart);

    if (this.#dollyDelta.y > 0) {
      this.#dollyOut(this.#getZoomScale(this.#dollyDelta.y));
    } else if (this.#dollyDelta.y < 0) {
      this.#dollyIn(this.#getZoomScale(this.#dollyDelta.y));
    }

    this.#dollyStart.copy(this.#dollyEnd);

    this.update();
  }

  #handleMouseMovePan(event: MouseEvent) {
    this.#panEnd.set(event.clientX, event.clientY);

    this.#panDelta.subVectors(this.#panEnd, this.#panStart).multiplyScalar(this.panSpeed);

    this.#pan(this.#panDelta.x, this.#panDelta.y);

    this.#panStart.copy(this.#panEnd);

    this.update();
  }

  #handleMouseWheel(event: WheelEvent) {
    this.#updateZoomParameters(event.clientX, event.clientY);

    if (event.deltaY < 0) {
      this.#dollyIn(this.#getZoomScale(event.deltaY));
    } else if (event.deltaY > 0) {
      this.#dollyOut(this.#getZoomScale(event.deltaY));
    }

    this.update();
  }

  #handleKeyDown(event: KeyboardEvent) {
    let needsUpdate = false;

    switch (event.code) {
      case this.keys.UP:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          this.#rotateUp((TWO_PI * this.rotateSpeed) / this.domElement.clientHeight);
        } else {
          this.#pan(0, this.keyPanSpeed);
        }

        needsUpdate = true;
        break;

      case this.keys.BOTTOM:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          this.#rotateUp((-TWO_PI * this.rotateSpeed) / this.domElement.clientHeight);
        } else {
          this.#pan(0, -this.keyPanSpeed);
        }

        needsUpdate = true;
        break;

      case this.keys.LEFT:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          this.#rotateLeft((TWO_PI * this.rotateSpeed) / this.domElement.clientHeight);
        } else {
          this.#pan(this.keyPanSpeed, 0);
        }

        needsUpdate = true;
        break;

      case this.keys.RIGHT:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          this.#rotateLeft((-TWO_PI * this.rotateSpeed) / this.domElement.clientHeight);
        } else {
          this.#pan(-this.keyPanSpeed, 0);
        }

        needsUpdate = true;
        break;
    }

    if (needsUpdate) {
      // prevent the browser from scrolling on cursor keys
      event.preventDefault();

      this.update();
    }
  }

  #handleTouchStartRotate(event: PointerEvent) {
    if (this.#pointers.length === 1) {
      this.#rotateStart.set(event.pageX, event.pageY);
    } else {
      const position = this.#getSecondPointerPosition(event);

      const x = 0.5 * (event.pageX + position.x);
      const y = 0.5 * (event.pageY + position.y);

      this.#rotateStart.set(x, y);
    }
  }

  #handleTouchStartPan(event: PointerEvent) {
    if (this.#pointers.length === 1) {
      this.#panStart.set(event.pageX, event.pageY);
    } else {
      const position = this.#getSecondPointerPosition(event);

      const x = 0.5 * (event.pageX + position.x);
      const y = 0.5 * (event.pageY + position.y);

      this.#panStart.set(x, y);
    }
  }

  #handleTouchStartDolly(event: PointerEvent) {
    const position = this.#getSecondPointerPosition(event);

    const dx = event.pageX - position.x;
    const dy = event.pageY - position.y;

    const distance = Math.sqrt(dx * dx + dy * dy);

    this.#dollyStart.set(0, distance);
  }

  #handleTouchStartDollyPan(event: PointerEvent) {
    if (this.enableZoom) {
      this.#handleTouchStartDolly(event);
    }

    if (this.enablePan) {
      this.#handleTouchStartPan(event);
    }
  }

  #handleTouchStartDollyRotate(event: PointerEvent) {
    if (this.enableZoom) {
      this.#handleTouchStartDolly(event);
    }

    if (this.enableRotate) {
      this.#handleTouchStartRotate(event);
    }
  }

  #handleTouchMoveRotate(event: PointerEvent) {
    if (this.#pointers.length == 1) {
      this.#rotateEnd.set(event.pageX, event.pageY);
    } else {
      const position = this.#getSecondPointerPosition(event);

      const x = 0.5 * (event.pageX + position.x);
      const y = 0.5 * (event.pageY + position.y);

      this.#rotateEnd.set(x, y);
    }

    this.#rotateDelta
      .subVectors(this.#rotateEnd, this.#rotateStart)
      .multiplyScalar(this.rotateSpeed);

    const element = this.domElement;

    this.#rotateLeft((TWO_PI * this.#rotateDelta.x) / element.clientHeight); // yes, height

    this.#rotateUp((TWO_PI * this.#rotateDelta.y) / element.clientHeight);

    this.#rotateStart.copy(this.#rotateEnd);
  }

  #handleTouchMovePan(event: PointerEvent) {
    if (this.#pointers.length === 1) {
      this.#panEnd.set(event.pageX, event.pageY);
    } else {
      const position = this.#getSecondPointerPosition(event);

      const x = 0.5 * (event.pageX + position.x);
      const y = 0.5 * (event.pageY + position.y);

      this.#panEnd.set(x, y);
    }

    this.#panDelta.subVectors(this.#panEnd, this.#panStart).multiplyScalar(this.panSpeed);

    this.#pan(this.#panDelta.x, this.#panDelta.y);

    this.#panStart.copy(this.#panEnd);
  }

  #handleTouchMoveDolly(event: PointerEvent) {
    const position = this.#getSecondPointerPosition(event);

    const dx = event.pageX - position.x;
    const dy = event.pageY - position.y;

    const distance = Math.sqrt(dx * dx + dy * dy);

    this.#dollyEnd.set(0, distance);

    this.#dollyDelta.set(0, Math.pow(this.#dollyEnd.y / this.#dollyStart.y, this.zoomSpeed));

    this.#dollyOut(this.#dollyDelta.y);

    this.#dollyStart.copy(this.#dollyEnd);

    const centerX = (event.pageX + position.x) * 0.5;
    const centerY = (event.pageY + position.y) * 0.5;

    this.#updateZoomParameters(centerX, centerY);
  }

  #handleTouchMoveDollyPan(event: PointerEvent) {
    if (this.enableZoom) {
      this.#handleTouchMoveDolly(event);
    }

    if (this.enablePan) {
      this.#handleTouchMovePan(event);
    }
  }

  #handleTouchMoveDollyRotate(event: PointerEvent) {
    if (this.enableZoom) {
      this.#handleTouchMoveDolly(event);
    }

    if (this.enableRotate) {
      this.#handleTouchMoveRotate(event);
    }
  }

  #onPointerDown = (event: PointerEvent) => {
    if (this.enabled === false) {
      return;
    }

    if (this.#pointers.length === 0) {
      this.domElement.setPointerCapture(event.pointerId);

      this.domElement.addEventListener('pointermove', this.#onPointerMove);
      this.domElement.addEventListener('pointerup', this.#onPointerUp);
    }

    //

    this.#addPointer(event);

    if (event.pointerType === 'touch') {
      this.#onTouchStart(event);
    } else {
      this.#onMouseDown(event);
    }
  };

  #onPointerMove = (event: PointerEvent) => {
    if (this.enabled === false) return;

    if (event.pointerType === 'touch') {
      this.#onTouchMove(event);
    } else {
      this.#onMouseMove(event);
    }
  };

  #onPointerUp = (event: PointerEvent) => {
    this.#removePointer(event);

    if (this.#pointers.length === 0) {
      this.domElement.releasePointerCapture(event.pointerId);

      this.domElement.removeEventListener('pointermove', this.#onPointerMove);
      this.domElement.removeEventListener('pointerup', this.#onPointerUp);
    }

    this.dispatchEvent(_endEvent);

    this.#state = STATE.NONE;
  };

  #onMouseDown = (event: MouseEvent) => {
    let mouseAction: THREE.MOUSE | number;

    switch (event.button) {
      case 0:
        mouseAction = this.mouseButtons.LEFT;
        break;

      case 1:
        mouseAction = this.mouseButtons.MIDDLE;
        break;

      case 2:
        mouseAction = this.mouseButtons.RIGHT;
        break;

      default:
        mouseAction = -1;
    }

    switch (mouseAction) {
      case THREE.MOUSE.DOLLY:
        if (this.enableZoom === false) {
          return;
        }

        this.#handleMouseDownDolly(event);

        this.#state = STATE.DOLLY;

        break;

      case THREE.MOUSE.ROTATE:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          if (this.enablePan === false) {
            return;
          }

          this.#handleMouseDownPan(event);

          this.#state = STATE.PAN;
        } else {
          if (this.enableRotate === false) {
            return;
          }

          this.#handleMouseDownRotate(event);

          this.#state = STATE.ROTATE;
        }

        break;

      case THREE.MOUSE.PAN:
        if (event.ctrlKey || event.metaKey || event.shiftKey) {
          if (this.enableRotate === false) {
            return;
          }

          this.#handleMouseDownRotate(event);

          this.#state = STATE.ROTATE;
        } else {
          if (this.enablePan === false) {
            return;
          }

          this.#handleMouseDownPan(event);

          this.#state = STATE.PAN;
        }

        break;

      default:
        this.#state = STATE.NONE;
    }

    if (this.#state !== STATE.NONE) {
      this.dispatchEvent(_startEvent);
    }
  };

  #onMouseMove = (event: MouseEvent) => {
    switch (this.#state) {
      case STATE.ROTATE:
        if (this.enableRotate === false) {
          return;
        }

        this.#handleMouseMoveRotate(event);

        break;

      case STATE.DOLLY:
        if (this.enableZoom === false) {
          return;
        }

        this.#handleMouseMoveDolly(event);

        break;

      case STATE.PAN:
        if (this.enablePan === false) {
          return;
        }

        this.#handleMouseMovePan(event);

        break;
    }
  };

  #onMouseWheel = (event: WheelEvent) => {
    if (this.enabled === false || this.enableZoom === false || this.#state !== STATE.NONE) {
      return;
    }

    event.preventDefault();

    this.dispatchEvent(_startEvent);

    this.#handleMouseWheel(event);

    this.dispatchEvent(_endEvent);
  };

  #onKeyDown = (event: KeyboardEvent) => {
    if (this.enabled === false || this.enablePan === false) {
      return;
    }

    this.#handleKeyDown(event);
  };

  #onTouchStart = (event: PointerEvent) => {
    this.#trackPointer(event);

    switch (this.#pointers.length) {
      case 1:
        switch (this.touches.ONE) {
          case THREE.TOUCH.ROTATE:
            if (this.enableRotate === false) {
              return;
            }

            this.#handleTouchStartRotate(event);

            this.#state = STATE.TOUCH_ROTATE;

            break;

          case THREE.TOUCH.PAN:
            if (this.enablePan === false) {
              return;
            }

            this.#handleTouchStartPan(event);

            this.#state = STATE.TOUCH_PAN;

            break;

          default:
            this.#state = STATE.NONE;
        }

        break;

      case 2:
        switch (this.touches.TWO) {
          case THREE.TOUCH.DOLLY_PAN:
            if (this.enableZoom === false && this.enablePan === false) {
              return;
            }

            this.#handleTouchStartDollyPan(event);

            this.#state = STATE.TOUCH_DOLLY_PAN;

            break;

          case THREE.TOUCH.DOLLY_ROTATE:
            if (this.enableZoom === false && this.enableRotate === false) {
              return;
            }

            this.#handleTouchStartDollyRotate(event);

            this.#state = STATE.TOUCH_DOLLY_ROTATE;

            break;

          default:
            this.#state = STATE.NONE;
        }

        break;

      default:
        this.#state = STATE.NONE;
    }

    if (this.#state !== STATE.NONE) {
      this.dispatchEvent(_startEvent);
    }
  };

  #onTouchMove = (event: PointerEvent) => {
    this.#trackPointer(event);

    switch (this.#state) {
      case STATE.TOUCH_ROTATE:
        if (this.enableRotate === false) {
          return;
        }

        this.#handleTouchMoveRotate(event);

        this.update();

        break;

      case STATE.TOUCH_PAN:
        if (this.enablePan === false) {
          return;
        }

        this.#handleTouchMovePan(event);

        this.update();

        break;

      case STATE.TOUCH_DOLLY_PAN:
        if (this.enableZoom === false && this.enablePan === false) {
          return;
        }

        this.#handleTouchMoveDollyPan(event);

        this.update();

        break;

      case STATE.TOUCH_DOLLY_ROTATE:
        if (this.enableZoom === false && this.enableRotate === false) {
          return;
        }

        this.#handleTouchMoveDollyRotate(event);

        this.update();

        break;

      default:
        this.#state = STATE.NONE;
    }
  };

  #onContextMenu = (event: MouseEvent) => {
    if (this.enabled === false) {
      return;
    }

    event.preventDefault();
  };

  #addPointer(event: PointerEvent) {
    this.#pointers.push(event.pointerId);
  }

  #removePointer(event: PointerEvent) {
    delete this.#pointerPositions[event.pointerId];

    for (let i = 0; i < this.#pointers.length; i++) {
      if (this.#pointers[i] == event.pointerId) {
        this.#pointers.splice(i, 1);
        return;
      }
    }
  }

  #trackPointer(event: PointerEvent) {
    let position = this.#pointerPositions[event.pointerId];

    if (position === undefined) {
      position = new THREE.Vector2();
      this.#pointerPositions[event.pointerId] = position;
    }

    position.set(event.pageX, event.pageY);
  }

  #getSecondPointerPosition(event: PointerEvent) {
    const pointerId = event.pointerId === this.#pointers[0] ? this.#pointers[1] : this.#pointers[0];

    return this.#pointerPositions[pointerId];
  }
}

export default BaseOrbitControls;
export { BaseOrbitControls };
