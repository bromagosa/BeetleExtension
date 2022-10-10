// 3D extension for 3D rendering and fabrication
// extensively inspired in Beetle Blocks 
// ---------------------------------------------
// Bernat Romagosa i Carrasquer, October 2022

// THREE.js additions ///////////////////////////////////////////////////


// TODO change when deploying
// monkey-patch load to prepend asset URL
THREE.OBJLoader.prototype.originalLoad = THREE.OBJLoader.prototype.load;
THREE.OBJLoader.prototype.load = function (path, callback) {
    this.originalLoad('http://localhost:8000/meshes/' + path, callback);
};


THREE.Object3D.prototype.addLineToPointWithColor = function
    (point, color, thickness)
{
    return this.addLineFromPointToPointWithColor(
        new THREE.Vector3(),
        point,
        color,
        thickness
    );
};

THREE.Object3D.prototype.addLineFromPointToPointWithColor = function
    (originPoint, destinationPoint, color, thickness)
{
    var line,
        geometry =
        new THREE.BufferGeometry().setFromPoints(
            [ originPoint, destinationPoint ]
        ),
        material =
            new THREE.LineBasicMaterial(
                { color: color, linewidth: (thickness ? thickness : 1) }
            ),
        line = new THREE.Line(geometry, material);

    this.add(line);
    return line;
};

// Snap! Additions ///////////////////////////////////////////////////////

// Unfortunately, there are some things I can't do without monkey-patching
// a few Snap! methods. I'm trying to keep them to a bare minimum.

if (!SpriteMorph.prototype.originalSetColorDimension) {
    SpriteMorph.prototype.originalSetColorDimension =
        SpriteMorph.prototype.setColorDimension;
    SpriteMorph.prototype.setColorDimension = function (idx, num) {
        var stage = this.parent;
        this.originalSetColorDimension(idx, num);
        if (stage.beetleController) {
            stage.beetleController.beetle.setColor(this.color.toRGBstring());
        }
    };

    SpriteMorph.prototype.originalSetColor = SpriteMorph.prototype.setColor;
    SpriteMorph.prototype.setColor = function (aColor) {
        var stage = this.parent;
        this.originalSetColor(aColor);
        if (stage.beetleController) {
            stage.beetleController.beetle.setColor(this.color.toRGBstring());
        }
    };

    SpriteMorph.prototype.originalSetPenDown = SpriteMorph.prototype.setPenDown;
    SpriteMorph.prototype.setPenDown = function (bool, noShadow) {
        var stage = this.parent;
        this.originalSetPenDown(bool, noShadow);
        if (stage.beetleController) {
            if (bool) {
                stage.beetleController.beetle.startRecordingExtrusionFace(
                    this.xPosition() / 100,
                    this.yPosition() / 100
                );
            } else {
                stage.beetleController.beetle.stopRecordingExtrusionFace();
                stage.beetleController.changed();
            }
        }
    };

    SpriteMorph.prototype.originalMoveBy = SpriteMorph.prototype.moveBy;
    SpriteMorph.prototype.moveBy = function (delta, justMe) {
        var stage = this.parent;
        this.originalMoveBy(delta, justMe);
    if (stage.beetleController) {
            if (stage.beetleController.beetle.recordingExtrusionFace) {
                stage.beetleController.beetle.recordExtrusionFacePoint(
                    this.xPosition() / 100,
                    this.yPosition() / 100
                );
            } else if (stage.beetleController.beetle.extrusionFace) {
                stage.beetleController.beetle.translateExtrusionFaceMeshBy(
                    delta.x / 100,
                    delta.y / 100
                );
            }
        }
    };
}

// Beetle ////////////////////////////////////////////////////////////////

Beetle.prototype = new THREE.Object3D();
Beetle.prototype.constructor = Beetle;
Beetle.uber = THREE.Object3D.prototype;

function Beetle (controller) {
    this.init(controller);
};

Beetle.prototype.init = function (controller) {
    var myself = this;

    this.controller = controller;

    this.name = 'beetle';

    this.initColor();

    this.linewidth = 1;
    this.posAndRotStack = [];
    this.multiplierScale = 1;

    this.loadMeshes();

    // extrusion
    this.extruding = false;
    this.recordingExtrusionFace = false;
    this.extrusionFace = new THREE.Shape();
    this.lastExtrusionFaceMesh = null;
    this.updateExtrusionFaceMesh();

    this.reset();

    this.axes = [];
    // beetle's local axis lines
    p = new THREE.Vector3(1,0,0);
    this.axes.push(this.addLineToPointWithColor(p, 0x00E11E));
    p = new THREE.Vector3(0,1,0);
    this.axes.push(this.addLineToPointWithColor(p, 0x0000FF));
    p = new THREE.Vector3(0,0,1);
    this.axes.push(this.addLineToPointWithColor(p, 0xFF0000));

    this.controller.changed();
};

Beetle.prototype.initColor = function () {
    // Find out if there's a current sprite, or any sprite at all
    var sprite = this.controller.stage.parent.currentSprite,
        color;
    if (sprite instanceof StageMorph) {
        if (sprite.children[0]) {
            sprite = sprite.children[0];
        } else {
            this.color = new THREE.Color(0xAAAAAA);
            return;
        }
    }
    this.color = new THREE.Color(sprite.color.toRGBstring());
};

Beetle.prototype.loadMeshes = function () {
    var material =
            new THREE.MeshLambertMaterial(
                { color: this.color, transparent: true }
            ),
        loader = new THREE.OBJLoader(),
        myself = this;

    this.shape = new THREE.Mesh(new THREE.BufferGeometry(), material);
    this.standingShape = new THREE.Object3D();
    this.shape.add(this.standingShape);
    this.shape.material = material;

    loader.load('beetle-gray.obj', function (object) {
        myself.standingShape.add(object);
        object.traverse(function (child) {
            if (child instanceof THREE.Mesh) {
                child.material =
                    new THREE.MeshLambertMaterial({ color: 0x888888 });
            }
        });
        object.rotation.set(-Math.PI / 2, 0, 0);
    });
    loader.load('beetle-black.obj', function (object) {
        myself.standingShape.add(object);
        object.traverse(function (child) {
            if (child instanceof THREE.Mesh) {
                child.material =
                    new THREE.MeshLambertMaterial({ color: 0x222222 });
            }
        });
        object.rotation.set(-Math.PI / 2, 0, 0);
    });
    loader.load('beetle-color.obj', function (object) {
        myself.standingShape.add(object);
        object.traverse(function (child) {
            if (child instanceof THREE.Mesh) {
                child.material = material;
            }
        });
        object.rotation.set(-Math.PI / 2, 0, 0);
        myself.controller.changed();
    });

    this.shape.rotation.x = radians(90);
    this.shape.name = 'beetleShape';

    this.add(this.shape);
};

Beetle.prototype.reset = function () {
    this.position.set(0, 0, 0);
    this.rotation.set(0, 0, 0);
};

Beetle.prototype.clear = function () {
    var objects = this.controller.objects;
    for (var i = objects.children.length - 1; i >= 0; i--) {
        objects.remove(objects.children[i]);
    }
    this.controller.renderer.clear();
    this.controller.changed();
};

Beetle.prototype.toggleVisibility = function () {
    this.shape.visible = !this.shape.visible;
    this.controller.changed();
};

Beetle.prototype.setColor = function (rgbString) {
    this.color = new THREE.Color(rgbString);
    this.shape.material.color = this.color;
    this.controller.changed();
};

// Extrusion support

Beetle.prototype.startRecordingExtrusionFace = function (x, y) {
    // ignore consecutive pen down instructions
    if (!this.recordingExtrusionFace) {
        this.recordingExtrusionFace = true;
        this.extrusionFace = new THREE.Shape();
        this.extrusionFace.origin = new THREE.Vector2(x, y);
        this.extrusionFace.moveTo(
            x - this.extrusionFace.origin.x,
            y - this.extrusionFace.origin.y
        );
        this.updateExtrusionFaceMesh();
    }
};

Beetle.prototype.stopRecordingExtrusionFace = function () {
    this.recordingExtrusionFace = false;
};

Beetle.prototype.recordExtrusionFacePoint = function (x, y) {
    this.extrusionFace.lineTo(
        x - this.extrusionFace.origin.x,
        y - this.extrusionFace.origin.y
    );
    this.updateExtrusionFaceMesh();
};

Beetle.prototype.translateExtrusionFaceMeshBy = function (x, y) {
    var points = this.extrusionFace.getPoints();
    if (points[0]) {
        this.extrusionFace =
            (new THREE.Shape()).setFromPoints(
                points.map(point => point.add(new THREE.Vector2(-x, y)))
            );
        this.updateExtrusionFaceMesh();
    }
};

Beetle.prototype.updateExtrusionFaceMesh = function () {
    this.remove(this.extrusionFaceMesh);
    this.extrusionFaceMesh = new THREE.Mesh(
        new THREE.ShapeGeometry(this.extrusionFace),
        new THREE.MeshBasicMaterial({
            color: this.color,
            side: THREE.DoubleSide
        })
    );
    this.add(this.extrusionFaceMesh);
    this.updateMatrixWorld();
    this.controller.changed();
};

Beetle.prototype.startExtruding = function () {
    this.extruding = true;
    this.extrudeToCurrentPoint();
    // TODO if no extrusionFace, don't extrude? maybe just draw?
};

Beetle.prototype.stopExtruding = function () {
    this.extruding = false;
    this.lastExtrusionFaceMesh = null;
};

Beetle.prototype.extrudeToCurrentPoint = function () {
    this.updateMatrixWorld();
    if (this.lastExtrusionFaceMesh) {
        var positions = this.lastExtrusionFaceMesh.geometry.attributes.position,
            points = [];
        for (var i = 0; i < positions.count; i++) {
            var p = new THREE.Vector3().fromBufferAttribute(positions, i);
            // translate the point to the previous extrusion face mesh
            this.lastExtrusionFaceMesh.localToWorld(p);
            points.push(p);
        }
        positions = this.extrusionFaceMesh.geometry.attributes.position;
        for (var i = 0; i < positions.count; i++) {
            var p = new THREE.Vector3().fromBufferAttribute(positions, i);
            // translate the point to the current extrusion face mesh
            this.localToWorld(p);
            points.push(p);
        }
        this.newExtrusion(points);
    }
    this.lastExtrusionFaceMesh = this.extrusionFaceMesh.clone();
};

Beetle.prototype.newExtrusion = function (points) {
    // Make a new mesh out of a convex geometry containing all the points
    // from the previous extrusionFaceMesh and the current one.
    var extrusionMesh = new THREE.Mesh(
        new THREE.ConvexGeometry(points),
        new THREE.MeshLambertMaterial({ color: this.color })
    );
    this.controller.objects.add(extrusionMesh);
    this.controller.changed();
};

// User facing methods, called from blocks

Beetle.prototype.forward = function (steps) {
    this.translateZ(Number(steps) * this.multiplierScale);
    this.controller.changed();
    if (this.extruding) { this.extrudeToCurrentPoint(); }
};

Beetle.prototype.goto = function (x, y, z) {
    if (x !== '') { this.position.setZ(Number(x)); }
    if (y !== '') { this.position.setX(Number(y)); }
    if (z !== '') { this.position.setY(Number(z)); }
    this.controller.changed();
    if (this.extruding) { this.extrudeToCurrentPoint(); }
};

Beetle.prototype.getPosition = function () {
    return new List([ this.position.z, this.position.x, this.position.y ]);
};

Beetle.prototype.setRotations = function (x, y, z) {
    if (x !== '') { this.rotation.z = radians(Number(x) * -1); }
    if (y !== '') { this.rotation.x = radians(Number(y) * -1); }
    if (z !== '') { this.rotation.y = radians(Number(z)); }
    this.controller.changed();
};

Beetle.prototype.getRotation = function () {
    return new List([
        degrees(this.rotation.z * -1),
        degrees(this.rotation.x * -1),
        degrees(this.rotation.y)
    ]);
};

Beetle.prototype.rotate = function (x, y, z) {
    if (x !== '') { this.rotateZ(radians(Number(x) * -1)); }
    if (y !== '') { this.rotateX(radians(Number(y) * -1)); }
    if (z !== '') { this.rotateY(radians(Number(z))); }
    this.controller.changed();
};

Beetle.prototype.pointTo = function (x, y, z) {
    this.lookAt(new THREE.Vector3(Number(y), Number(z), Number(x)));
    this.controller.changed();
};


// BeetleController //////////////////////////////////////////////////////

function BeetleController (stage) {
    this.init(stage);
};

BeetleController.prototype.init = function (stage) {
    this.stage = stage;

    this.objects = new THREE.Object3D();

    this.renderWidth = 480;
    this.renderHeight = 360;

    this.initScene();
    this.initRenderer();
    this.initCamera();
    this.initLights();
    this.initOrbitControlsDiv();

    this.beetle = new Beetle(this);

    this.scene.add(this.objects);
    this.scene.add(this.beetle);
};

BeetleController.prototype.open = function () {
    if (!this.dialog) {
        this.dialog = new BeetleDialogMorph(
            this.stage,
            this
        );
        this.dialog.popUp(this.stage.world());
    }
};

BeetleController.prototype.renderExtent = function () {
    return new Point(this.renderWidth, this.renderHeight);
};

BeetleController.prototype.initRenderer = function () {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.renderWidth, this.renderHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0xAAAAAA, 1);
    this.renderer.shouldRerender = false;
};

BeetleController.prototype.initLights = function () {
    this.directionalLight = new THREE.DirectionalLight(0x4c4c4c, 1);
    this.directionalLight.position.set(this.camera.position);
    this.scene.add(this.directionalLight);

    this.pointLight = new THREE.PointLight(0xffffff, 1, 2000);
    this.pointLight.position.set(this.camera.position);
    this.scene.add(this.pointLight);
};

BeetleController.prototype.initCamera = function () {
    var myself = this;

    if (this.scene.camera) { this.scene.remove(this.camera) };

    this.camera = new THREE.PerspectiveCamera(60, 480/360);

    this.camera.reset = function () {
        this.position.set(-5, 7, 5);
        this.lookAt(0, 0, 0);
        myself.changed();
    };

    this.scene.add(this.camera);
};

BeetleController.prototype.initScene = function () {
    var myself = this;

    this.scene = new THREE.Scene();
    this.scene.axes = [];

    // Axes
    this.scene.axes.push(
        this.scene.addLineToPointWithColor(
            new THREE.Vector3(4,0,0), 0x00E11E, 2
        )
    );
    this.scene.axes.push(
        this.scene.addLineToPointWithColor(
            new THREE.Vector3(0,4,0), 0x0000FF, 2
        )
    );
    this.scene.axes.push(
        this.scene.addLineToPointWithColor(
            new THREE.Vector3(0,0,4), 0xFF0000, 2
        )
    );
};

BeetleController.prototype.initOrbitControlsDiv = function () {
    this.orbitControlsDiv = document.createElement('div');
    this.orbitControlsDiv.style.width = '480px';
    this.orbitControlsDiv.style.height = '360px';
    this.orbitControlsDiv.style.visibility = 'hidden';
    document.body.append(this.orbitControlsDiv);
};

BeetleController.prototype.changed = function () {
    this.renderer.shouldRerender = true;
};

BeetleController.prototype.renderCycle = function () {
    this.render3D();
    this.renderer.shouldRerender = false;
};

BeetleController.prototype.render3D = function () {
    this.pointLight.position.copy(this.camera.position); // lights move w/camera
    this.directionalLight.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
};

// BeetleDialogMorph ////////////////////////////////////////////////////

// BeetleDialogMorph inherits from DialogBoxMorph:

BeetleDialogMorph.prototype = new DialogBoxMorph();
BeetleDialogMorph.prototype.constructor = BeetleDialogMorph;
BeetleDialogMorph.uber = DialogBoxMorph.prototype;

// BeetleDialogMorph instance creation

function BeetleDialogMorph(stage, controller, onAccept) {
    this.init(controller, onAccept);
}

BeetleDialogMorph.prototype.init = function (controller, onAccept) {
    this.controller = controller;

    this.padding = 12;
    this.onaccept = onAccept;

    this.initRenderView();
    this.initControls();

    BeetleDialogMorph.uber.init.call(this);
    this.labelString = '3D Rendering';
    this.createLabel();
    this.buildContents();

    this.controller.camera.reset();
    this.controller.changed();
};

BeetleDialogMorph.prototype.buildContents = function () {
    this.addBody(new AlignmentMorph('column', this.padding / 2));
    this.body.add(this.renderView);
    this.body.fixLayout();

    this.addButton('ok', 'Close');
    this.addButton('resetCamera', 'Reset Camera');

    this.fixLayout();
    this.controller.changed();
};

BeetleDialogMorph.prototype.initRenderView = function () {
    var controller = this.controller;

    this.renderView = new Morph(); // a morph where we'll display the 3d content
    this.renderView.setExtent(controller.renderExtent());

    this.renderView.drawOn = function (ctx, rect) {
        var clipped = rect.intersect(this.bounds),
            pos = this.position(),
            pic = controller.renderer.domElement,
            src, w, h, sl, st;

        if (!clipped.extent().gt(ZERO)) {return; }

        ctx.save();

        src = clipped.translateBy(pos.neg());
        sl = src.left();
        st = src.top();
        w = Math.min(src.width(), pic.width - sl);
        h = Math.min(src.height(), pic.height - st);
        if (w < 1 || h < 1) {return; }
        ctx.drawImage(
            pic,
            sl,
            st,
            w,
            h,
            clipped.left(),
            clipped.top(),
            w,
            h
        );
        ctx.restore();
    };

    this.renderView.step = function () {
        if (controller.renderer.shouldRerender) {
            controller.renderCycle();
            this.changed();
        }
    };
};

BeetleDialogMorph.prototype.initControls = function () {
    // Get rid of old controls if there were any. They would interfere with the
    // new ones and make the camera behave in the weirdest way.
    if (this.controller.controls) { this.controller.controls.dispose(); }

    var controller = this.controller,
        controls =
            new THREE.OrbitControls(
                controller.camera,
                controller.orbitControlsDiv
            );

    controller.controls = controls;

    this.renderView.mouseScroll = function (y, x) {
        var e = new Event('wheel');
        e.deltaY = y * -1;
        controller.orbitControlsDiv.dispatchEvent(e);
        controls.update();
        controller.changed();
    };
    
    this.renderView.mouseMove = function (pos, button) {
        var e = new Event('pointermove');
        e.clientX = pos.x;
        e.clientY = pos.y;
        e.pageX = pos.x;
        e.pageY = pos.y;
        controller.orbitControlsDiv.dispatchEvent(e);
        controls.update();
        controller.changed();
    };

    this.renderView.mouseClickLeft = function (pos) {
        controller.orbitControlsDiv.dispatchEvent(new Event('pointerup'));
    };

    this.renderView.mouseClickRight = function (pos) {
        controller.orbitControlsDiv.dispatchEvent(new Event('pointerup'));
    };

    this.renderView.mouseDownLeft = function (pos) {
        var e = new Event('pointerdown');
        e.button = 0;
        e.clientX = pos.x;
        e.clientY = pos.y;
        e.pageX = pos.x;
        e.pageY = pos.y;
        controller.orbitControlsDiv.dispatchEvent(e);
    };

    this.renderView.mouseDownRight = function (pos) {
        var e = new Event('pointerdown');
        e.button = 2;
        e.clientX = pos.x;
        e.clientY = pos.y;
        e.pageX = pos.x;
        e.pageY = pos.y;
        controller.orbitControlsDiv.dispatchEvent(e);
        e = new Event('contextmenu');
        e.button = 2;
        e.clientX = pos.x;
        e.clientY = pos.y;
        e.pageX = pos.x;
        e.pageY = pos.y;
        controller.orbitControlsDiv.dispatchEvent(e);
    }; 

    controls.update();
};

BeetleDialogMorph.prototype.resetCamera = function () {
    this.controller.camera.reset();
    this.initControls();
};

BeetleDialogMorph.prototype.ok = function () {
    this.onaccept?.call(this);
    this.close();
};

BeetleDialogMorph.prototype.close = function () {
    this.controller.dialog = null;
    BeetleDialogMorph.uber.destroy.call(this);
};

// SnapExtensions API ////////////////////////////////////////////////////

SnapExtensions.primitives.set('bb_open()', function () {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) {
        stage.beetleController = new BeetleController(stage);
    }
    stage.beetleController.open();
});

SnapExtensions.primitives.set('bb_clear()', function (steps) {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.clear();
});

SnapExtensions.primitives.set('bb_forward(steps)', function (steps) {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.forward(steps);
});

SnapExtensions.primitives.set('bb_goto(x, y, z)', function (x, y, z) {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.goto(x, y, z);
});

SnapExtensions.primitives.set('bb_position()', function () {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    return stage.beetleController.beetle.getPosition();
});

SnapExtensions.primitives.set('bb_setrot(x, y, z)', function (x, y, z) {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.setRotations(x, y, z);
});

SnapExtensions.primitives.set('bb_rotation()', function () {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    return stage.beetleController.beetle.getRotation();
});

SnapExtensions.primitives.set('bb_rotate(x, y, z)', function (x, y, z) {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.rotate(x, y, z);
});

SnapExtensions.primitives.set('bb_pointto(x, y, z)', function (x, y, z) {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.pointTo(x, y, z);
});

SnapExtensions.primitives.set('bb_startextruding()', function () {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.startExtruding();
});

SnapExtensions.primitives.set('bb_stopextruding()', function () {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.stopExtruding();
});
