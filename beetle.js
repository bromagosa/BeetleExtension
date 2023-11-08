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

    this.shouldRerender = false;

    this.renderWidth = 480;
    this.renderHeight = 360;

    this.initCanvas();
    this.initEngine();
    this.initScene();
    this.initCamera();
    this.initLights();
    this.initGrid();

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
};

BABYLON.ArcRotateCamera.prototype.isMoving = function () {
    return (this.inertialPanningX !== 0) ||
        (this.inertialPanningY !== 0) ||
        (this.inertialAlphaOffset !== 0) ||
        (this.inertialBetaOffset !== 0) ||
        (this.inertialRadiusOffset !== 0);
};

BABYLON.ArcRotateCamera.prototype.zoomBy = function (delta) {
    this.inertialRadiusOffset = delta * 0.5;
};

BABYLON.ArcRotateCamera.prototype.rotateBy = function (deltaXY) {
    if (this.clickOrigin) {
        var deltaX = deltaXY.x - this.clickOrigin.x,
            deltaY = deltaXY.y - this.clickOrigin.y;
        this.inertialAlphaOffset = deltaX * -0.0005;
        this.inertialBetaOffset = deltaY * -0.001;
    }
};

BABYLON.ArcRotateCamera.prototype.panBy = function (deltaXY) {
    var deltaX = deltaXY.x - this.clickOrigin.x,
        deltaY = deltaXY.y - this.clickOrigin.y;
    this.inertialPanningX = deltaX * -0.001;
    this.inertialPanningY = deltaY * 0.001;
};

BeetleController.prototype.initLights = function () {
    this.light = new BABYLON.HemisphericLight(
        'ambientLight', new BABYLON.Vector3(0, 1, 0), this.scene);
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

    this.gizmoManager = new BABYLON.GizmoManager(this.scene);
    this.gizmoManager.positionGizmoEnabled = true;
    this.gizmoManager.attachableMeshes = [this.grid];
    this.gizmoManager.attachToMesh(this.grid);
};

BeetleController.prototype.changed = function () {
    this.shouldRerender = true;
};

BeetleController.prototype.render = function () {
    if (this.scene && this.shouldRerender || this.camera.isMoving()) {
        this.scene.render();
        this.dialog.changed();
        this.shouldRerender = false;
    }
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
    // check https://doc.babylonjs.com/features/featuresDeepDive/behaviors/cameraBehaviors#framing-behavior
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
    var beetle = this.controller.beetle;
    if (this.beetleEnabled()) { beetle.hide(); } else { beetle.show(); }
    this.controller.changed();
};

BeetleDialogMorph.prototype.beetleEnabled = function () {
    return this.controller.beetle.isVisible();
};

BeetleDialogMorph.prototype.toggleWireframe = function () {
};

BeetleDialogMorph.prototype.wireframeEnabled = function () {
};

BeetleDialogMorph.prototype.toggleGhostMode = function () {
};

BeetleDialogMorph.prototype.ghostModeEnabled = function () {
};

BeetleDialogMorph.prototype.exportSTL = function () {
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
    this.posAndRotStack = [];
    this.multiplierScale = 1;

    // logging, for gcode exporting and maybe other features
    this.log = [];
    this.logging = false;

    this.loadMeshes();
    this.wings = null;
    this.body = new BABYLON.TransformNode('body', this.controller.scene);
    this.initAxes();

    // extrusion
    this.extruding = false;
    this.recordingExtrusionShape = false;
    this.extrusionShape = this.defaultExtrusionShape();
    this.updateExtrusionShapeMesh();
    this.lastExtrusionShapeMesh = null;
    this.lastPosition = new BABYLON.Vector3();

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

    this.extrusionShapeMesh.material = new BABYLON.StandardMaterial(
        'extrusionShapeMesh',
        this.controller.scene
    );
    this.extrusionShapeMesh.rotate(BABYLON.Axis.X, Math.PI / 2);
    this.updateExtrusionShapeMeshColor();

    this.controller.changed();
};

Beetle.prototype.updateExtrusionShapeMeshColor = function () {
    if (this.extrusionShapeMesh && this.wings?.material) {
        this.extrusionShapeMesh.material.diffuseColor =
            this.wings.material.diffuseColor;
    }
}

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

Beetle.prototype.clear = function () {}; // shouldn't it be a controller method?

Beetle.prototype.forward = function (steps) {
    this.lastPosition = this.body.position.clone();
    this.body.locallyTranslate(
        new BABYLON.Vector3(0, 0, Number(steps) * this.multiplierScale)
    );
    this.controller.changed();
    if (this.extruding) { this.extrudeToCurrentPoint(); }
};

Beetle.prototype.goto = function (x, y, z) {
    this.lastPosition = this.body.position.clone();
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
    var quaternion = this.body.rotationQuaternion.toEulerAngles();
    return new List([
        degrees(quaternion.z),
        degrees(quaternion.x * -1),
        degrees(quaternion.y * -1)
    ]);
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

Beetle.prototype.extrudeToCurrentPoint = function () {};
Beetle.prototype.stopExtruding = function () {};
Beetle.prototype.setScale = function (scale) {
    this.multiplierScale = scale;
    this.updateExtrusionShapeMesh();
};

Beetle.prototype.currentCostume = function () {};
Beetle.prototype.getLog = function () {};

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
