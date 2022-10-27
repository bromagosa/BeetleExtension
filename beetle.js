// 3D extension for 3D rendering and fabrication
// extensively inspired in Beetle Blocks 
// ---------------------------------------------
// 🄯 Bernat Romagosa i Carrasquer, October 2022

// THREE.js additions ///////////////////////////////////////////////////


// TODO change when deploying
// monkey-patch load to prepend asset URL
THREE.BaseURL = 'http://localhost:8000/'

THREE.OBJLoader.prototype.originalLoad = THREE.OBJLoader.prototype.load;
THREE.OBJLoader.prototype.load = function (path, callback) {
    return this.originalLoad(THREE.BaseURL + 'meshes/' + path, callback);
};

THREE.TextureLoader.prototype.originalLoad = THREE.TextureLoader.prototype.load;
THREE.TextureLoader.prototype.load = function (path, callback) {
    return this.originalLoad(THREE.BaseURL + 'img/' + path, callback);
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
    var geometry = new THREE.BufferGeometry().setFromPoints(
            [ originPoint, destinationPoint ]
        ),
        material = new THREE.LineBasicMaterial({
            color: color,
            linewidth: (thickness || 1) // ignored by most WebGL implementations
        }),
        line = new THREE.Line(geometry, material);

    this.add(line);
    return line;
};

// Super Simple Cache
THREE.Cache = { materials: new Map() };
THREE.Cache.getMaterial = function (color) {
    var key = (typeof color == 'number' ? color : color.getHex()),
        material = this.materials.get(key);

    if (!material) {
        material = new THREE.MeshLambertMaterial(
            { color: color, side: THREE.DoubleSide }
        );
        this.materials.set(key, material);
    }

    return material;
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
        if (stage?.beetleController &&
            this.parentThatIsA(IDE_Morph).currentSprite === this
        ) {
            stage.beetleController.beetle.setColor(this.color.toRGBstring());
        }
    };

    SpriteMorph.prototype.originalSetColor = SpriteMorph.prototype.setColor;
    SpriteMorph.prototype.setColor = function (aColor) {
        var stage = this.parent;
        this.originalSetColor(aColor);
        if (stage?.beetleController &&
            this.parentThatIsA(IDE_Morph).currentSprite === this
        ) {
            stage.beetleController.beetle.setColor(this.color.toRGBstring());
        }
    };

    SpriteMorph.prototype.originalSetPenDown = SpriteMorph.prototype.setPenDown;
    SpriteMorph.prototype.setPenDown = function (bool, noShadow) {
        var stage = this.parent;
        this.originalSetPenDown(bool, noShadow);
        if (stage?.beetleController &&
            this.parentThatIsA(IDE_Morph).currentSprite === this
        ) {
            if (bool) {
                if (stage.beetleController.beetle.recordingExtrusionFace) {
                    stage.beetleController.beetle.recordExtrusionFacePoint(
                        this.xPosition() / 100,
                        this.yPosition() / 100
                    );
                } else {
                    stage.beetleController.beetle.startRecordingExtrusionFace(
                        this.xPosition() / 100,
                        this.yPosition() / 100
                    );
                }
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
        if (stage?.beetleController &&
            this.parentThatIsA(IDE_Morph).currentSprite === this
        ) {
            if (stage.beetleController.beetle.recordingExtrusionFace) {
                if (this.isDown) {
                    stage.beetleController.beetle.recordExtrusionFacePoint(
                        this.xPosition() / 100,
                        this.yPosition() / 100
                    );
                }
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

    // logging, for gcode exporting and maybe other features
    this.log = [];
    this.logging = false;

    this.loadMeshes();

    // extrusion
    this.extruding = false;
    this.recordingExtrusionFace = false;
    this.extrusionFace = new THREE.Shape();
    this.lastExtrusionFaceMesh = null;
    this.lastPosition = new THREE.Vector3();
    this.updateExtrusionFaceMesh();

    this.reset();

    // beetle's local axis lines
    this.axes = [];
    [
        [[1,0,0], 0x00E11E],
        [[0,1,0], 0x0000FF],
        [[0,0,1], 0xFF0000]
    ].forEach(each =>
        this.axes.push(
            this.addLineToPointWithColor(
                new THREE.Vector3(...each[0]), each[1], 2
            )
        )
    );

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
    var material = new THREE.MeshLambertMaterial({ color: this.color }),
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
                child.material = THREE.Cache.getMaterial(0x888888);
            }
        });
        object.rotation.set(-Math.PI / 2, 0, 0);
    });
    loader.load('beetle-black.obj', function (object) {
        myself.standingShape.add(object);
        object.traverse(function (child) {
            if (child instanceof THREE.Mesh) {
                child.material = THREE.Cache.getMaterial(0x222222);
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
    this.log = [];
};

Beetle.prototype.clear = function () {
    var objects = this.controller.objects;
    for (var i = objects.children.length - 1; i >= 0; i--) {
        objects.remove(objects.children[i]);
    }
    this.controller.renderer.clear();
    this.controller.changed();
    this.log = [];
};

Beetle.prototype.toggle = function () {
    this.shape.visible = !this.shape.visible;
    this.extrusionFaceMesh.visible = this.shape.visible;
    this.controller.changed();
};

Beetle.prototype.setColor = function (rgbString) {
    this.color = new THREE.Color(rgbString);
    this.shape.material.color = this.color;
    this.controller.changed();
};

// Logging

Beetle.prototype.getLog = function () {
    return new List(
        this.log.map(
            entry => new List([
                entry[0],
                new List([
                    entry[1].x,
                    entry[1].y,
                    entry[1].z
                ])
            ])
        )
    );
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
    this.extrusionFaceMesh.scale.setScalar(this.multiplierScale);
    this.add(this.extrusionFaceMesh);
    this.updateMatrixWorld();
    this.controller.changed();
};

Beetle.prototype.stopExtruding = function () {
    this.extruding = false;
    if (this.logging) { this.log.push([ 'penup', this.position ]); }
    this.lastExtrusionFaceMesh = null;
};

// Actual extrusion mesh building.
Beetle.prototype.extrudeToCurrentPoint = function () {

    if (this.logging) {
        if (!this.extruding) { this.log.push([ 'pendown', this.position ]); }
        this.log.push([ 'goto', this.position ]);
    }

    this.extruding = true;
    this.updateMatrixWorld();

    if (this.extrusionFace.getPoints()[0]) {
        // if there's a base face, extrude
        this.makePrism();
    } else {
        // otherwise, draw a line
        this.controller.objects.addLineFromPointToPointWithColor(
            this.lastPosition,
            this.position,
            this.color,
            this.multiplierScale
        );
    }
};

Beetle.prototype.makePrism = function () {
    // Computes the vertices for a truncated prism with the previous face and
    // current face as end shapes, then calls makePrismMesh to actually build
    // and add the 3D object to the scene
    if (this.lastExtrusionFaceMesh) {
        var facePositions =
                this.lastExtrusionFaceMesh.geometry.attributes.position,
            numSides = facePositions.count,
            numVertices = numSides * 2 + numSides * 4, // prism faces are rects
            extrusionPositions =
                new Float32Array(numVertices * 3), // 3 components per vertex
            readOffset, writeOffset;

        // Back face
        for (var i = 0; i < numSides * 3; i += 3) {
            var p = new THREE.Vector3().fromBufferAttribute(facePositions, i/3);
            // translate the point to the previous extrusion face mesh
            this.lastExtrusionFaceMesh.localToWorld(p);
            extrusionPositions.set([p.x, p.y, p.z], i);
        }

        // Front face
        facePositions = this.extrusionFaceMesh.geometry.attributes.position;
        for (var i = 0; i < numSides * 3; i += 3) {
            var p = new THREE.Vector3().fromBufferAttribute(facePositions, i/3);
            // translate the point to the current extrusion face mesh
            this.extrusionFaceMesh.localToWorld(p);
            extrusionPositions.set(
                [p.x, p.y, p.z],
                numSides * 3 + i
            );
        }

        // Prism sides, one per vertex in prism base

        // Do not ever change this code. It took AGES to get right and it works
        // great now. If something fails, look somewhere else first.
        function addPositions() {
            extrusionPositions.set(
                [
                    extrusionPositions[readOffset],     // x
                    extrusionPositions[readOffset + 1], // y
                    extrusionPositions[readOffset + 2]  // z
                ],
                writeOffset
            );
            writeOffset += 3;
        };

        writeOffset = numSides * 3 * 2;
        for (var i = 0; i < numSides; i ++) {
            readOffset = i * 3;
            addPositions();

            readOffset = (readOffset + 3) % (numSides * 3);
            addPositions();

            readOffset = (i + numSides) * 3;
            addPositions();

            readOffset = (((i + 1) % numSides) + numSides) * 3;
            addPositions();
        }

        this.makePrismMesh(extrusionPositions, numSides);
    }

    this.lastExtrusionFaceMesh = this.extrusionFaceMesh.clone();
}

Beetle.prototype.makePrismMesh = function (extrusionPositions, sideCount) {
    // Make a new mesh out of all the vertex positions created by the
    // extrudeToCurrentPoint method.
    var extrusionGeometry = new THREE.BufferGeometry(),
        baseIndex = this.extrusionFaceMesh.geometry.index.array,
        index = [],
        normals = [],
        offset;

    extrusionGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(extrusionPositions, 3)
    );

    // Add base shape indices.
    index.push(...[...baseIndex].reverse()); // reverse a copy of the index
    index.push(...baseIndex.map(v => v + sideCount));

    // Add indices for all prism faces. Since faces are always rectangles,
    // there are 4 vertices per prism face.
    for (n = 0; n < sideCount * 4; n += 4) {
        offset = n + sideCount * 2;
        index.push(offset, offset + 2, offset + 3);
        index.push(offset + 3, offset + 1, offset);
    }

    extrusionGeometry.setIndex(index);
    extrusionGeometry.computeVertexNormals();

    this.controller.objects.add(
        new THREE.Mesh(extrusionGeometry, THREE.Cache.getMaterial(this.color))
    );
    this.controller.changed();
};

// User facing methods, called from blocks

Beetle.prototype.forward = function (steps) {
    this.lastPosition = this.position.clone();
    this.translateZ(Number(steps) * this.multiplierScale);
    this.controller.changed();
    if (this.extruding) { this.extrudeToCurrentPoint(); }
};

Beetle.prototype.goto = function (x, y, z) {
    this.lastPosition = this.position.clone();
    if (x !== '') { this.position.setX(Number(x)); }
    if (y !== '') { this.position.setY(Number(y)); }
    if (z !== '') { this.position.setZ(Number(z)); }
    this.controller.changed();
    if (this.extruding) { this.extrudeToCurrentPoint(); }
};

Beetle.prototype.getPosition = function () {
    return new List([ this.position.x, this.position.y, this.position.z ]);
};

Beetle.prototype.setRotations = function (x, y, z) {
    if (x !== '') { this.rotation.x = radians(Number(x) * -1); }
    if (y !== '') { this.rotation.y = radians(Number(y) * -1); }
    if (z !== '') { this.rotation.z = radians(Number(z)); }
    this.controller.changed();
};

Beetle.prototype.getRotation = function () {
    return new List([
        degrees(this.rotation.x * -1),
        degrees(this.rotation.y),
        degrees(this.rotation.z * -1)
    ]);
};

Beetle.prototype.rotate = function (x, y, z) {
    if (x !== '') { this.rotateX(radians(Number(x) * -1)); }
    if (y !== '') { this.rotateY(radians(Number(y) * -1)); }
    if (z !== '') { this.rotateZ(radians(Number(z))); }
    this.controller.changed();
};

Beetle.prototype.pointTo = function (x, y, z) {
    this.lookAt(new THREE.Vector3(Number(x), Number(y), Number(z)));
    this.controller.changed();
};

Beetle.prototype.setScale = function (scale) {
    this.multiplierScale = scale;
    this.updateExtrusionFaceMesh();
};


// BeetleController //////////////////////////////////////////////////////

function BeetleController (stage) {
    this.init(stage);
};

BeetleController.prototype.init = function (stage) {
    this.stage = stage;

    this.objects = new THREE.Object3D();

    this.renderWidth = 480 * devicePixelRatio;
    this.renderHeight = 360 * devicePixelRatio;

    this.initRenderer();
    this.initScene();
    this.initCamera();
    this.initLights();
    this.initOrbitControlsDiv();

    this.beetle = new Beetle(this);

    this.scene.add(this.objects);
    this.scene.add(this.beetle);
};

BeetleController.prototype.open = function () {
    if (!this.stage.world().childThatIsA(BeetleDialogMorph)) {
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

    this.camera = new THREE.PerspectiveCamera(
        60,
        this.renderWidth / this.renderHeight
    );

    this.camera.reset = function () {
        this.position.set(-5, 7, 5);
        this.lookAt(0, 0, 0);
        myself.changed();
    };

    this.scene.add(this.camera);
};

BeetleController.prototype.initScene = function () {
    this.scene = new THREE.Scene();
    this.grid = new BeetleGrid(this);
    this.initAxes();
};

BeetleController.prototype.initAxes = function () {
    this.showAxes = true;
    this.scene.axes = [];
    this.scene.labels = [];

    [
        [[4,0,0], 0x00E11E],
        [[0,4,0], 0x0000FF],
        [[0,0,4], 0xFF0000]
    ].forEach(each =>
        this.scene.axes.push(
            this.scene.addLineToPointWithColor(
                new THREE.Vector3(...each[0]), each[1], 2
            )
        )
    );

    // Labels
    var loader = new THREE.TextureLoader(),
        axes = { x: 0x00E11E, y: 0x0000FF , z: 0xFF0000 };

    Object.keys(axes).forEach(
        axis => {
            var map = loader.load(axis + '.png', () => this.changed()),
                material = new THREE.SpriteMaterial(
                    { map: map, color: axes[axis] }
                ),
                sprite = new THREE.Sprite(material);

            map.minFilter = THREE.NearestFilter;

            sprite.position['set' + axis.toUpperCase()].call(
                sprite.position,
                4.3
            );
            sprite.scale.set(0.3, 0.3, 0.3);
            sprite.name = axis;

            this.scene.labels.push(sprite);
            this.scene.add(sprite);
        }
    );

};

BeetleController.prototype.toggleAxes = function () {
    this.showAxes = !this.showAxes;
    this.beetle.axes.forEach(axis => axis.visible = this.showAxes);
    this.scene.axes.forEach(axis => axis.visible = this.showAxes);
    this.scene.labels.forEach(label => label.visible = this.showAxes);
    this.changed();
};

BeetleController.prototype.initOrbitControlsDiv = function () {
    this.orbitControlsDiv = document.createElement('div');
    this.orbitControlsDiv.style.width = this.renderWidth + 'px';
    this.orbitControlsDiv.style.height = this.renderHeight + 'px';
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

BeetleController.prototype.exportSTL = function () {
    var stlString = new THREE.STLExporter().parse(this.objects);
    saveAs(
        new Blob([stlString], {type: 'text/plain'}),
        (this.projectName ? this.projectName : 'objects') + '.stl'
    );
};

BeetleController.prototype.currentCostume = function () {
    var wasShowingAxes = this.showAxes,
        wasShowingBeetle = this.beetle.shape.visible,
        wasShowingGrid = this.grid.visible,
        canvas = newCanvas(
            new Point(this.renderWidth, this.renderHeight),
            true
        ),
        ctx = canvas.getContext('2d'),
        costume;

    if (wasShowingAxes) { this.toggleAxes(); }
    if (wasShowingBeetle) { this.dialog.toggleBeetle(); }
    if (wasShowingGrid) { this.dialog.toggleGrid(); }

    this.renderer.setClearColor(0xFFFFFFF, 0);
    this.render3D();

    ctx.drawImage(this.renderer.domElement, 0, 0);
    costume = new Costume(
        canvas,
        this.stage.newCostumeName(localize('render'))
    );

    if (wasShowingAxes) { this.toggleAxes(); }
    if (wasShowingBeetle) { this.dialog.toggleBeetle(); }
    if (wasShowingGrid) { this.dialog.toggleGrid(); }

    this.renderer.setClearColor(0xAAAAAA, 1);
    this.render3D();

    return costume;
};


// BeetleGrid ///////////////////////////////////////////////////////////

function BeetleGrid (controller) {
    this.init(controller);
};

BeetleGrid.prototype.init = function (controller) {
    this.controller = controller;
    this.color = 0x888888;
    this.visible = true;
    this.draw();
};

BeetleGrid.prototype.draw = function () {
    this.lines = [];

    for (x = -10; x <= 10; x++) {
        l = this.controller.scene.addLineFromPointToPointWithColor(
            new THREE.Vector3(x, 0, -10),
            new THREE.Vector3(x, 0, 10),
            this.color
        );
        l.visible = this.visible;
        this.lines.push(l);
    }

    for (y = -10; y <= 10; y++) {
        l = this.controller.scene.addLineFromPointToPointWithColor(
            new THREE.Vector3(-10, 0, y),
            new THREE.Vector3(10, 0, y),
            this.color
        );
        l.visible = this.visible;
        this.lines.push(l);
    }

    this.controller.changed();
};

BeetleGrid.prototype.toggle = function () {
    this.visible = !this.visible;
    this.lines.forEach(line => line.visible = this.visible);
    this.controller.changed();
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
    this.addButton('resetCamera', 'Recenter');
    this.addButton('toggleGrid', 'Grid');
    this.addButton('toggleAxes', 'Axes');
    this.addButton('toggleBeetle', 'Beetle');
    this.addButton('exportSTL', 'Export');

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

BeetleDialogMorph.prototype.toggleGrid = function () {
    this.controller.grid.toggle();
};

BeetleDialogMorph.prototype.toggleAxes = function () {
    this.controller.toggleAxes();
};

BeetleDialogMorph.prototype.toggleBeetle = function () {
    this.controller.beetle.toggle();
};

BeetleDialogMorph.prototype.exportSTL = function () {
    this.controller.exportSTL();
};

BeetleDialogMorph.prototype.ok = function () {
    this.onaccept?.call(this);
    this.close();
};

BeetleDialogMorph.prototype.close = function () {
    BeetleDialogMorph.uber.destroy.call(this);
};

// SnapExtensions API ////////////////////////////////////////////////////

// Buttons

SnapExtensions.buttons.palette.push({
    category: '3D Beetle',
    label: 'Open 3D Window',
    hideable: false,
    action: function () {
        var stage = this.parentThatIsA(StageMorph);
        if (!stage.beetleController) {
            stage.beetleController = new BeetleController(stage);
        }
        stage.beetleController.open();
    }
});

// Redo palette so the button actually shows up

world.children[0].flushBlocksCache();
world.children[0].refreshPalette();

// Primitives

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
    stage.beetleController.beetle.extrudeToCurrentPoint();
});

SnapExtensions.primitives.set('bb_stopextruding()', function () {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.stopExtruding();
});

SnapExtensions.primitives.set('bb_setscale(scale)', function (scale) {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.setScale(scale);
});

SnapExtensions.primitives.set('bb_scale()', function () {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    return stage.beetleController.beetle.multiplierScale;
});

SnapExtensions.primitives.set('bb_costume()', function () {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    return stage.beetleController.currentCostume();
});

SnapExtensions.primitives.set('bb_setlog(bool)', function (bool) {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.logging = bool;
});

SnapExtensions.primitives.set('bb_log()', function () {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    return stage.beetleController.beetle.getLog();
});
