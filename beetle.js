// 3D extension for 3D rendering and fabrication
// extensively inspired in Beetle Blocks
// ---------------------------------------------
// 🄯 Bernat Romagosa i Carrasquer, September 2023

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
            stage.beetleController.beetle.setColor(this.color);
        }
    };

    SpriteMorph.prototype.originalSetColor = SpriteMorph.prototype.setColor;
    SpriteMorph.prototype.setColor = function (aColor) {
        var stage = this.parent;
        this.originalSetColor(aColor);
        if (stage?.beetleController &&
            this.parentThatIsA(IDE_Morph).currentSprite === this
        ) {
            stage.beetleController.beetle.setColor(this.color);
        }
    };
}

// BeetleController //////////////////////////////////////////////////////

function BeetleController (stage) {
    this.init(stage);
};

BeetleController.prototype.init = function (stage) {
    this.stage = stage;

    this.engine = null;
    this.scene = null;
    this.camera = null;
    this.grid = null;
    this.glCanvas = null;
    this.gizmoManager = null;

    this.ghostModeEnabled = false;
    this.wireframeEnabled = false;

    this.shouldRerender = false;
    this.frameTick = 0;

    this.renderWidth = 480;
    this.renderHeight = 360;

    this.initCanvas();
    this.initEngine();
    this.initScene();
    this.initCamera();
    this.initLights();
    this.initGrid();

    this.beetleTrails = [];

    this.beetle = new Beetle(this);
};

BeetleController.prototype.open = function () {
    if (!this.stage.world().childThatIsA(BeetleDialogMorph)) {
        this.dialog = new BeetleDialogMorph(
            this.stage,
            this
        );
        this.dialog.popUp(this.stage.world());
        this.changed();
    }
};

BeetleController.prototype.renderExtent = function () {
    return new Point(this.renderWidth, this.renderHeight);
};

BeetleController.prototype.initCanvas = function () {
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.width = this.renderWidth;
    this.glCanvas.height = this.renderHeight;
};

BeetleController.prototype.initEngine = function () {
    this.engine = new BABYLON.Engine(
        this.glCanvas,
        true,
        {
            preserveDrawingBuffer: true,
            stencil: true
        }
    );
};

BeetleController.prototype.initScene = function () {
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color3(.5, .5, .5);
};

BeetleController.prototype.initCamera = function () {
    this.camera = new BABYLON.ArcRotateCamera(
        'beetleCam', 0, 0, 10, new BABYLON.Vector3(0, 5, -10), this.scene);
    this.camera.lowerRadiusLimit = 1.5;
    this.camera.reset();
};

BABYLON.ArcRotateCamera.prototype.reset = function () {
    this.radius = 10;
    this.setTarget(BABYLON.Vector3.Zero());
    this.setPosition(new BABYLON.Vector3(0, 5, -10));
    this.alpha = Math.PI / 4;
    this.framing = false;
    if (this.framingBehavior) {
        this.framingBehavior.detach(this);
        this.framingBehavior = null;
    }
};

BABYLON.ArcRotateCamera.prototype.isMoving = function () {
    return (this.inertialPanningX !== 0) ||
        (this.inertialPanningY !== 0) ||
        (this.inertialAlphaOffset !== 0) ||
        (this.inertialBetaOffset !== 0) ||
        (this.inertialRadiusOffset !== 0) ||
        (this.framing);
};

BABYLON.ArcRotateCamera.prototype.zoomBy = function (delta) {
    this.inertialRadiusOffset = delta * 0.5;
    this.framing = false;
};

BABYLON.ArcRotateCamera.prototype.rotateBy = function (deltaXY) {
    if (this.clickOrigin) {
        var deltaX = deltaXY.x - this.clickOrigin.x,
            deltaY = deltaXY.y - this.clickOrigin.y;
        this.inertialAlphaOffset = deltaX * -0.0005;
        this.inertialBetaOffset = deltaY * -0.001;
    }
    this.framing = false;
};

BABYLON.ArcRotateCamera.prototype.panBy = function (deltaXY) {
    var deltaX = deltaXY.x - this.clickOrigin.x,
        deltaY = deltaXY.y - this.clickOrigin.y;
    this.inertialPanningX = deltaX * -0.001;
    this.inertialPanningY = deltaY * 0.001;
    this.framing = false;
};

BeetleController.prototype.initLights = function () {
    this.light = new BABYLON.HemisphericLight(
        'ambientLight',
        new BABYLON.Vector3(0, 1, 0),
        this.scene
    );
    this.camera.light = new BABYLON.PointLight(
        'pointLight',
        this.camera.position,
        this.scene
    );
    this.camera.light.parent = this.camera;
};

BeetleController.prototype.initGrid = function () {
    var gridMaterial = new BABYLON.GridMaterial('default', this.scene);
    gridMaterial.majorUnitFrequency = 10;
    gridMaterial.gridRatio = 1;
    gridMaterial.backFaceCulling = false;
    gridMaterial.minorUnitVisibility = 0.45;
    gridMaterial.backFaceCulling = false;
    gridMaterial.mainColor = new BABYLON.Color3(1, 1, 1);
    gridMaterial.lineColor = new BABYLON.Color3(1.0, 1.0, 1.0);
    gridMaterial.opacity = 0.98;

    this.grid = BABYLON.MeshBuilder.CreateGround(
        'grid',
        { width: 100, height: 100 },
        this.scene
    );
    this.grid.material = gridMaterial;

    // Axes Gizmo
    this.gizmoManager = new BABYLON.GizmoManager(this.scene);
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.attachableMeshes = [this.grid];
    this.gizmoManager.attachToMesh(this.grid);
};

BeetleController.prototype.changed = function () {
    this.shouldRerender = true;
};

BeetleController.prototype.render = function () {
    this.frameTick = (this.frameTick + 1) % 1000;
    if (this.scene && this.shouldRerender || this.camera.isMoving()) {
        this.scene.render();
        this.dialog.changed();
        this.shouldRerender = false;
    }
    if (((this.frameTick % 10) == 0) && this.beetleTrails[1]) {
        merged = BABYLON.Mesh.MergeMeshes(
            this.beetleTrails.slice(0,50),
            true,
            true,
            undefined,
            true,
            true
        );
        for (var i = 0; i < 50; i ++) {
            if (this.beetleTrails[i]) {
                this.beetleTrails[i].dispose();
                this.scene.removeMesh(this.beetleTrails[i]);
            }
        }
        this.beetleTrails.splice(1,49);
        this.beetleTrails[0] = merged;
    }
};

BeetleController.prototype.beetleTrailsBoundingBox = function () {
    var min = this.beetleTrails[0].getBoundingInfo().boundingBox.minimumWorld,
        max = this.beetleTrails[0].getBoundingInfo().boundingBox.maximumWorld;

    this.beetleTrails.forEach(obj => {
        var box = obj.getBoundingInfo().boundingBox;
        min.x = Math.min(min.x, box.minimumWorld.x);
        min.y = Math.min(min.y, box.minimumWorld.y);
        min.z = Math.min(min.z, box.minimumWorld.z);
        max.x = Math.max(max.x, box.maximumWorld.x);
        max.y = Math.max(max.y, box.maximumWorld.y);
        max.z = Math.max(max.z, box.maximumWorld.z);
    });
    return new BABYLON.BoundingBox(min, max);
};

// User facing methods, called from blocks

BeetleController.prototype.clear = function () {
    this.beetleTrails.forEach(object => object.dispose());
    this.beetleTrails = [];
    this.changed();
};

// Simple Cache //////////////////////////////////////////////////////////

BeetleController.Cache = {
    materials: new Map(),
    indices: new Map(),
    normals: new Map()
};

BeetleController.Cache.getMaterial = function (color) {
    var key = color.r + ',' + color.g + ',' + color.b,
        material = this.materials.get(key);

    if (!material) {
        material = new BABYLON.StandardMaterial(color.toString()); // name
        material.diffuseColor.set(color.r, color.g, color.b);
        this.materials.set(key, material);
    }

    return material;
};

BeetleController.hash = function (object) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57, str = object.toString();
    for (var i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1  = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2  = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

BeetleController.Cache.getIndices = function (query) {
    var hash = BeetleController.hash(query),
        indices = this.indices.get(hash);

    if (!indices) {
        indices = query;
        this.indices.set(hash, indices);
    }

    return indices;
};

BeetleController.Cache.getNormals = function (query) {
    var hash = BeetleController.hash(query),
        normals = this.normals.get(hash);

    if (!normals) {
        normals = query;
        this.normals.set(hash, normals);
    }

    return normals;
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
    this.initControlPanel();
    this.initMouseControls();

    BeetleDialogMorph.uber.init.call(this);
    this.labelString = '3D Beetle';
    this.createLabel();
    this.buildContents();
};

BeetleDialogMorph.prototype.buildContents = function () {
    this.addBody(new AlignmentMorph('column', this.padding * 2));
    this.body.add(this.renderView);
    this.body.add(this.controlPanel);
    this.controlPanel.fixLayout();
    this.body.fixLayout();

    this.addButton('exportSTL', 'Export');
    this.addButton('ok', 'Close');

    this.fixLayout();
};

BeetleDialogMorph.prototype.initRenderView = function () {
    var controller = this.controller;

    this.renderView = new Morph(); // a morph where we'll display the 3d content
    this.renderView.setExtent(controller.renderExtent());

    this.renderView.drawOn = function (ctx, rect) {
        var pic = controller.glCanvas;

        window.ctx = ctx;

        ctx.save();
        ctx.drawImage(
            pic,
            0,
            0,
            controller.renderWidth,
            controller.renderHeight,
            this.left(),
            this.top(),
            controller.renderWidth,
            controller.renderHeight
        );
        ctx.restore();

    };

    this.renderView.step = function () { controller.render(); };
};

BeetleDialogMorph.prototype.initControlPanel = function () {
    var columns = [
        [
            {
                label: 'Beetle',
                type: 'toggle',
                action: 'toggleBeetle',
                query: 'beetleEnabled'
            },
            {
                label: 'Grid',
                type: 'toggle',
                action: 'toggleGrid',
                query: 'gridEnabled'
            },
            {
                label: 'Axes',
                type: 'toggle',
                action: 'toggleAxes',
                query: 'axesEnabled'
            }
        ],
        [
            {
                label: 'Wireframe',
                type: 'toggle',
                action: 'toggleWireframe',
                query: 'wireframeEnabled'
            },
            {
                label: 'Ghost mode',
                type: 'toggle',
                action: 'toggleGhostMode',
                query: 'ghostModeEnabled'
            }
        ],
        [
            {
                label: 'Zoom to fit',
                type: 'button',
                action: 'zoomToFit'
            },
            {
                label: 'Reset Camera',
                type: 'button',
                action: 'resetCamera'
            }
        ]
    ];

    this.controlPanel = new AlignmentMorph('row', this.padding * 4);

    columns.forEach(column => {
        var columnMorph = new AlignmentMorph('column', this.padding / 2);
        columnMorph.alignment = 'left';
        this.controlPanel.add(columnMorph);
        column.forEach(item => {
            if (item.type === 'button') {
                columnMorph.add(
                    new PushButtonMorph(this, item.action, item.label)
                );
            } else if (item.type === 'toggle') {
                columnMorph.add(
                    new ToggleMorph(
                        'checkbox',
                        this,
                        item.action,
                        item.label,
                        item.query
                    )
                );
            }

        });
    });

    this.controlPanel.fixLayout = function () {
        var myself = this;
        AlignmentMorph.prototype.fixLayout.call(this);
        this.children.forEach(child => {
            child.setTop(myself.top);
            child.fixLayout();
        });
    };
};

BeetleDialogMorph.prototype.initMouseControls = function () {
    var controller = this.controller;

    this.renderView.mouseScroll = function (y, x) {
        controller.camera.zoomBy(y);
    };

    this.renderView.mouseDownLeft = function (pos) {
        controller.camera.clickOrigin = pos;
    };
    this.renderView.mouseDownRight = this.renderView.mouseDownLeft;

    this.renderView.mouseMove = function (pos, button) {
        if (button === 'left') {
            controller.camera.rotateBy(pos);
        } else if (button === 'right') {
            controller.camera.panBy(pos);
        }
    };
};

BeetleDialogMorph.prototype.resetCamera = function () {
    this.controller.camera.reset();
    this.controller.changed();
};

BeetleDialogMorph.prototype.zoomToFit = function () {
    if (this.controller.beetleTrails[0] && !this.controller.camera.framing) {
        var box = this.controller.beetleTrailsBoundingBox(),
            cam = this.controller.camera,
            framingBehavior = new BABYLON.FramingBehavior();

        cam.inertialPanningX = 0;
        cam.inertialPanningY = 0;
        cam.inertialAlphaOffset = 0;
        cam.inertialBetaOffset = 0;
        cam.inertialRadiusOffset = 0;
        cam.framing = true;

        framingBehavior.attach(cam);
        cam.framingBehavior = framingBehavior;
        framingBehavior.zoomOnBoundingInfo(
            box.minimumWorld,
            box.maximumWorld,
            false,
            () => {
                cam.framing = false;
                framingBehavior.detach(cam);
            }
        );
    }
};

BeetleDialogMorph.prototype.toggleGrid = function () {
    this.controller.grid.visibility = this.gridEnabled() ? 0 : 1;
    this.controller.changed();
};

BeetleDialogMorph.prototype.gridEnabled = function () {
    return this.controller.grid.visibility == 1;
};

BeetleDialogMorph.prototype.toggleAxes = function () {
    this.controller.gizmoManager.positionGizmoEnabled =
        !this.controller.gizmoManager.positionGizmoEnabled;
    this.controller.beetle.gizmoManager.positionGizmoEnabled =
        this.controller.gizmoManager.positionGizmoEnabled;
    this.controller.changed();
};

BeetleDialogMorph.prototype.axesEnabled = function () {
    return this.controller.gizmoManager.positionGizmoEnabled;
};

BeetleDialogMorph.prototype.toggleBeetle = function () {
    //FIXME should toggle just the beetle, not the extrusion shape mesh
    // I should make it so the extrusion shape mesh can also be toggled
    var beetle = this.controller.beetle;
    if (this.beetleEnabled()) { beetle.hide(); } else { beetle.show(); }
    this.controller.changed();
};

BeetleDialogMorph.prototype.beetleEnabled = function () {
    return this.controller.beetle.isVisible();
};

BeetleDialogMorph.prototype.toggleWireframe = function () {
    this.controller.wireframeEnabled = !this.controller.wireframeEnabled;
    BeetleController.Cache.materials.forEach(material =>
        material.wireframe = this.controller.wireframeEnabled
    );
    this.controller.changed();
};

BeetleDialogMorph.prototype.wireframeEnabled = function () {
    return this.controller.wireframeEnabled;
};

BeetleDialogMorph.prototype.toggleGhostMode = function () {
    this.controller.ghostModeEnabled = !this.controller.ghostModeEnabled;
    this.controller.beetleTrails.forEach(object =>
        object.visibility = this.controller.ghostModeEnabled ? .25 : 1
    );
    this.controller.changed();
};

BeetleDialogMorph.prototype.ghostModeEnabled = function () {
    return this.controller.ghostModeEnabled;
};

BeetleDialogMorph.prototype.exportSTL = function () {
    BABYLON.STLExport.CreateSTL(
        this.controller.beetleTrails,
        true, // download
        'beetle-trails', // filename
        false, // binary ?
        false // little endian?
    );
};

BeetleDialogMorph.prototype.ok = function () {
    this.onaccept?.call(this);
    this.close();
};

BeetleDialogMorph.prototype.close = function () {
    BeetleDialogMorph.uber.destroy.call(this);
};

// Beetle ////////////////////////////////////////////////////

function Beetle (controller) {
    this.init(controller);
};

Beetle.prototype.init = function (controller) {
    this.controller = controller;

    this.name = 'beetle';

    this.linewidth = 1;
    this.multiplierScale = 1;

    this.loadMeshes();
    this.wings = null;
    this.body = new BABYLON.TransformNode('body', this.controller.scene);
    this.initAxes();

    // extrusion
    this.extruding = false;
    this.recordingExtrusionShape = false;
    this.extrusionShape = this.defaultExtrusionShape();
    this.extrusionShapeMesh = null;
    this.updateExtrusionShapeMesh();

    this.controller.changed();
};

Beetle.prototype.initAxes = function () {
    this.gizmoManager = new BABYLON.GizmoManager(this.controller.scene);
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.attachableMeshes = [this.body];
    this.gizmoManager.attachToMesh(this.body);
};

Beetle.prototype.initColor = function () {
    // Find out if there's a current sprite, or any sprite at all
    var sprite = this.controller.stage.parent.currentSprite,
        color;
    if (sprite instanceof StageMorph) {
        if (sprite.children[0]) {
            sprite = sprite.children[0];
        } else {
            return;
        }
    }
    this.setColor(sprite.color);
    this.controller.changed();
};

Beetle.prototype.setColor = function (color) {
    this.wings.material.diffuseColor =
        new BABYLON.Color3(color.r / 255, color.g / 255, color.b / 255);

    this.updateExtrusionShapeMeshColor();

    this.controller.changed();
};

Beetle.prototype.loadMeshes = function () {
    ['gray', 'color', 'black'].forEach(
        (each) =>
            BABYLON.SceneLoader.ImportMesh(
                '',
                baseUrl + 'meshes/',
                'beetle-' + each + '.obj',
                this.controller.scene,
                meshes => {
                    meshes.forEach(mesh => mesh.parent = this.body);
                    if (each !== 'black') {
                        meshes.forEach(
                            mesh => {
                                mesh.material =
                                    new BABYLON.StandardMaterial(
                                        each,
                                        this.controller.scene
                                    );
                                mesh.material.diffuseColor.set(.5,.5,.5);
                            }
                        );
                    }
                    if (each === 'color') {
                        this.wings = meshes[0];
                        this.initColor();
                    }
                }
            )
    );
};

// Extrusion support

Beetle.prototype.defaultExtrusionShape = function () {
    var path = [],
        radius = .5;

    for (var theta = 0; theta < 2 * Math.PI; theta += Math.PI / 16) {
        path.push(
            new BABYLON.Vector3(
                radius * Math.cos(theta),
                0,
                radius * Math.sin(theta),
            )
        );
    }

    return path;
};

Beetle.prototype.updateExtrusionShapeMesh = function () {
    if (this.extrusionShapeMesh) {
        this.controller.scene.removeMesh(this.extrusionShapeMesh);
    }

    this.extrusionShapeMesh = BABYLON.MeshBuilder.CreatePolygon(
        'extrusionShape',
        {
            shape: this.extrusionShape,
            sideOrientation: BABYLON.Mesh.DOUBLESIDE
        },
        this.controller.scene
    );
    this.extrusionShapeMesh.parent = this.body;
    this.extrusionShapeMesh.scalingDeterminant = this.multiplierScale;
    this.extrusionShapeMesh.rotate(BABYLON.Axis.X, Math.PI / 2);
    this.updateExtrusionShapeMeshColor();

    this.controller.changed();
};

Beetle.prototype.updateExtrusionShapeMeshColor = function () {
    if (this.extrusionShapeMesh && this.wings?.material) {
        this.extrusionShapeMesh.material = this.wings.material;
    }
};

Beetle.prototype.extrudeToCurrentPoint = function () {
    this.extruding = true;
    if (this.extrusionShape) {
        // if there is a base shape, extrude it to the current point
        this.makePrism();
    } else {
        // otherwise, draw a line
        // https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/param/lines
    }
};

Beetle.prototype.makePrism = function () {
    var currentTransformMatrix = this.extrusionShapeMesh.computeWorldMatrix(true);
    if (this.lastTransformMatrix) {
        var backShape = this.extrusionShape.map(
                v =>
                    BABYLON.Vector3.TransformCoordinates(
                        v,
                        this.lastTransformMatrix
                    )
                ),
            vertexData = new BABYLON.VertexData(),
            frontShape = this.extrusionShape.map(
                v =>
                    BABYLON.Vector3.TransformCoordinates(
                        v,
                        currentTransformMatrix
                    )
                ),
            meshIndices = this.extrusionShapeMesh.geometry.getIndices(),
            readOffset,
            writeOffset,
            positions = [],
            indices = [],
            normals = [],
            numSides = this.extrusionShape.length,
            prism = new BABYLON.Mesh('prism', this.controller.scene);

        positions = backShape.reverse().flatMap(v=>[v.x, v.y, v.z]),
        indices = meshIndices.slice(0, meshIndices.length / 2),
        positions.push(...frontShape.reverse().flatMap(v=>[v.x, v.y, v.z]));
        indices.push(...[...indices].reverse().map(i => i + numSides));

        // Add indices for all prism faces. Since faces are always rectangles,
        // there are 4 vertices per prism face.
        for (var n = 0; n < numSides * 4; n += 4) {
            var offset = n + numSides * 2;
            indices.push(offset, offset + 2, offset + 3);
            indices.push(offset + 3, offset + 1, offset);
        }

        // Prism sides, one per vertex in prism base

        // Do not ever change this code. It took AGES to get right and it works
        // great now. If something fails, look somewhere else first.
        function addPositions() {
            positions[writeOffset] = positions[readOffset];             // x
            positions[writeOffset + 1] = positions[readOffset + 1];     // y
            positions[writeOffset + 2] = positions[readOffset + 2];     // z
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

        BABYLON.VertexData.ComputeNormals(positions, indices, normals);

        vertexData.positions = positions;
        vertexData.indices = BeetleController.Cache.getIndices(indices);
        vertexData.normals = BeetleController.Cache.getNormals(normals);

        vertexData.applyToMesh(prism);
        prism.material = BeetleController.Cache.getMaterial(
            this.wings.material.diffuseColor
        );
        prism.visibility = this.controller.ghostModeEnabled ? .25 : 1;
        prism.material.wireframe = this.controller.wireframeEnabled;

        this.controller.beetleTrails.push(prism);
    }
    this.lastTransformMatrix = currentTransformMatrix.clone();
    this.controller.changed();
};

Beetle.prototype.stopExtruding = function () {
    this.extruding = false;
    this.lastTransformMatrix = null;
};

Beetle.prototype.show = function () {
    this.body.getChildren().forEach(mesh => mesh.visibility = 1);
};

Beetle.prototype.hide = function () {
    this.body.getChildren().forEach(mesh => mesh.visibility = 0);
};

Beetle.prototype.isVisible = function () {
    return this.body.getChildren()[0] ?
        this.body.getChildren()[0].visibility === 1 :
        true;
};

// User facing methods, called from blocks

Beetle.prototype.forward = function (steps) {
    this.body.locallyTranslate(
        new BABYLON.Vector3(0, 0, Number(steps) * this.multiplierScale)
    );
    this.controller.changed();
    if (this.extruding) { this.extrudeToCurrentPoint(); }
};

Beetle.prototype.goto = function (x, y, z) {
    if (x !== '') { this.body.position.z = Number(x); }
    if (y !== '') { this.body.position.x = Number(y); }
    if (z !== '') { this.body.position.y = Number(z); }
    this.controller.changed();
    if (this.extruding) { this.extrudeToCurrentPoint(); }
};

Beetle.prototype.getPosition = function () {
    return new List([
        this.body.position.z,
        this.body.position.x,
        this.body.position.y
    ]);
};

Beetle.prototype.setRotations = function (x, y, z) {
    this.body.rotationQuaternion = null;
    if (x !== '') { this.body.rotation.z = radians(Number(x)); }
    if (y !== '') { this.body.rotation.x = radians(Number(y) * -1); }
    if (z !== '') { this.body.rotation.y = radians(Number(z) * -1); }
    this.body.rotationQuaternion = this.body.rotation.toQuaternion();
    this.controller.changed();
};

Beetle.prototype.getRotation = function () {
    if (this.body.rotationQuaternion) {
        var rotation = this.body.rotationQuaternion.toEulerAngles();
        return new List([
            degrees(rotation.z),
            degrees(rotation.x * -1),
            degrees(rotation.y * -1)
        ]);
    } else {
        return new List([0,0,0]);
    }
};

Beetle.prototype.rotate = function (x, y, z) {
    if (x !== '') {
        this.body.rotate(BABYLON.Axis.Z, radians(Number(x)));
    }
    if (y !== '') {
        this.body.rotate(BABYLON.Axis.X, radians(Number(y)) * -1);
    }
    if (z !== '') {
        this.body.rotate(BABYLON.Axis.Y, radians(Number(z)) * -1);
    }
    this.controller.changed();
};

Beetle.prototype.pointTo = function (x, y, z) {
    this.body.lookAt(new BABYLON.Vector3(Number(z), Number(x), Number(y)));
    this.controller.changed();
};

Beetle.prototype.setScale = function (scale) {
    this.multiplierScale = scale;
    this.updateExtrusionShapeMesh();
};

Beetle.prototype.currentCostume = function () {};

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
    stage.beetleController.clear();
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
