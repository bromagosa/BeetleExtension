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
    disableRetinaSupport();
    this.glCanvas = document.createElement('canvas');
    this.glCanvas.isRetinaEnabled = false;
    this.glCanvas.width = this.renderWidth;
    this.glCanvas.height = this.renderHeight;
};

BeetleController.prototype.initEngine = function () {
    this.engine = new BABYLON.Engine(
        this.glCanvas,
        true,
        {
            preserveDrawingBuffer: true,
            stencil: true,
            adaptToDeviceRatio: true
        }
    );
    enableRetinaSupport();
};

BeetleController.prototype.initScene = function () {
    this.scene = new BABYLON.Scene(this.engine);
    this.scene.clearColor = new BABYLON.Color3(.5, .5, .5);
    this.scene.shadowsEnabled = false;
    this.scene.collisionEnabled = false;
    this.scene.physicsEnabled = false;
};

BeetleController.prototype.initCamera = function () {
    this.camera = new BABYLON.ArcRotateCamera(
        'beetleCam', 0, 0, 10, new BABYLON.Vector3(0, 5, -10), this.scene);
    this.camera.controller = this;
    this.camera.lowerRadiusLimit = 1.5;
    this.camera.fpvEnabled = false;
    this.camera.reset();
};

BABYLON.ArcRotateCamera.prototype.reset = function () {
    if (this.fpvEnabled) {
        this.setFPV(false);
    }
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
    if (!this.fpvEnabled) {
        // the lower radius limit gets stuck sometimes, so let's set it always
        this.lowerRadiusLimit = 1.5;
        this.inertialRadiusOffset = delta * (this.radius / 12);
        this.framing = false;
    }
};

BABYLON.ArcRotateCamera.prototype.rotateBy = function (deltaXY) {
    if (!this.fpvEnabled) {
        if (this.clickOrigin) {
            var deltaX = deltaXY.x - this.clickOrigin.x,
                deltaY = deltaXY.y - this.clickOrigin.y;
            this.inertialAlphaOffset = deltaX * -0.0005;
            this.inertialBetaOffset = deltaY * -0.001;
        }
        this.framing = false;
    }
};

BABYLON.ArcRotateCamera.prototype.panBy = function (deltaXY) {
    if (!this.fpvEnabled) {
        var deltaX = deltaXY.x - this.clickOrigin.x,
            deltaY = deltaXY.y - this.clickOrigin.y;
        this.inertialPanningX = deltaX * (this.radius / -10000);
        this.inertialPanningY = deltaY * (this.radius / 10000);
        this.framing = false;
    }
};

BABYLON.ArcRotateCamera.prototype.toggleFPV = function () {
    this.setFPV(!this.fpvEnabled);
};

BABYLON.ArcRotateCamera.prototype.setFPV = function (setIt) {
    this.fpvEnabled = setIt;
    this.framing = false;
    this.inertialPanningX = 0;
    this.inertialPanningY = 0;
    this.inertialAlphaOffset = 0;
    this.inertialBetaOffset = 0;
    this.inertialRadiusOffset = 0;
    if (setIt) {
        this.saveViewpoint();
        this.parent = this.controller.beetle.body;
        this.position = new BABYLON.Vector3(0,0,-0.5);
        this.target = new BABYLON.Vector3(0,0,0);
        this.lowerRadiusLimit = 0.5;
        this.radius = 0.5;
        this.light.specular = new BABYLON.Color3.Black;
        this.controller.changed();
    } else {
        this.parent = null;
        this.light.specular = new BABYLON.Color3.White;
        this.reset();
        this.restoreViewpoint();
    }
    this.controller.changed();
};

BABYLON.ArcRotateCamera.prototype.saveViewpoint = function () {
    this.oldViewpoint = {
        alpha: this.alpha,
        beta: this.beta,
        radius: this.radius,
        position: this.position.clone(),
        target: this.target.clone()
    };
};

BABYLON.ArcRotateCamera.prototype.restoreViewpoint = function () {
    if (this.oldViewpoint) {
        this.position = this.oldViewpoint.position;
        this.target = this.oldViewpoint.target;
        this.alpha = this.oldViewpoint.alpha;
        this.beta = this.oldViewpoint.beta;
        this.radius = this.oldViewpoint.radius;
    }
};

BeetleController.prototype.initLights = function () {
    this.topLight = new BABYLON.HemisphericLight(
        'topLight',
        new BABYLON.Vector3(0, 1, 0),
        this.scene
    );
    this.topLight.specular = new BABYLON.Color3.Black; // no reflections

    this.bottomLight = new BABYLON.HemisphericLight(
        'bottomLight',
        new BABYLON.Vector3(0, -1, 0),
        this.scene
    );
    this.bottomLight.specular = new BABYLON.Color3.Black; // no reflections

    this.camera.light = new BABYLON.PointLight(
        'pointLight',
        this.camera.position,
        this.scene
    );
    this.camera.light.specular = new BABYLON.Color3.White;
    this.camera.light.parent = this.camera;
};

BeetleController.prototype.initGrid = function () {
    var gridMaterial = new BABYLON.GridMaterial('default', this.scene);
    gridMaterial.majorUnitFrequency = 10;
    gridMaterial.gridRatio = 1;
    gridMaterial.backFaceCulling = false;
    gridMaterial.minorUnitVisibility = 0.45;
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
    if (this.scene && this.shouldRerender || this.camera.isMoving()) {
        this.scene.render();
        this.dialog.changed();
        this.shouldRerender = false;
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

BeetleController.prototype.currentView = function () {
    var wasShowingAxes = this.dialog.axesEnabled(),
        wasShowingBeetle = this.dialog.beetleEnabled(),
        wasShowingGrid = this.dialog.gridEnabled,
        wasFPV = this.dialog.fpvEnabled(),
        canvas = newCanvas(
            new Point(
                this.renderWidth,
                this.renderHeight
            ),
            true
        ),
        ctx = canvas.getContext('2d'),
        costume;

    if (wasShowingAxes) { this.dialog.toggleAxes(); }
    if (wasShowingBeetle) { this.dialog.toggleBeetle(); }
    if (wasShowingGrid) { this.dialog.toggleGrid(); }
    if (!wasFPV) { this.camera.toggleFPV(); }

    this.scene.clearColor = new BABYLON.Color4(0,0,0,0);
    this.scene.render();
    ctx.drawImage(
        this.glCanvas,
        0,
        0,
        this.renderWidth,
        this.renderHeight
    );
    costume = new Costume(
        canvas,
        this.stage.newCostumeName(localize('render'))
    );

    if (wasShowingAxes) { this.dialog.toggleAxes(); }
    if (wasShowingBeetle) { this.dialog.toggleBeetle(); }
    if (wasShowingGrid) { this.dialog.toggleGrid(); }
    if (!wasFPV) { this.camera.toggleFPV(); }

    this.scene.clearColor = new BABYLON.Color3(.5,.5,.5);
    this.scene.render();

    return costume;
};

// Simple Cache //////////////////////////////////////////////////////////

BeetleController.Cache = {
    materials: new Map(),
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
    // TODO this is not being used at the moment
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

    // a morph where we'll display the 3d content
    this.renderView = new Morph();
    this.renderView.setExtent(controller.renderExtent());

    this.renderView.render = function (ctx) {
        ctx.drawImage(
            controller.glCanvas,
            0,
            0,
            controller.renderWidth,
            controller.renderHeight
        );
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
            },
            {
                label: 'Extrusion base',
                type: 'toggle',
                action: 'toggleExtrusionBase',
                query: 'extrusionBaseEnabled'
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
            },
            {
                label: 'First person view',
                type: 'toggle',
                action: 'toggleFPV',
                query: 'fpvEnabled'
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
    this.controlPanel.children.forEach(column =>
        column.children.forEach(morph => {
            if (morph.refresh) { morph.refresh(); }
        })
    );
    this.controller.changed();
};

BeetleDialogMorph.prototype.zoomToFit = function () {
    if (this.controller.beetleTrails[0] && !this.controller.camera.framing) {
        if (this.fpvEnabled()) { this.resetCamera(); }
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
    var beetle = this.controller.beetle;
    if (this.beetleEnabled()) { beetle.hide(); } else { beetle.show(); }
    this.controller.changed();
};

BeetleDialogMorph.prototype.beetleEnabled = function () {
    return this.controller.beetle.isVisible();
};

BeetleDialogMorph.prototype.toggleExtrusionBase = function () {
    this.controller.beetle.extrusionShapeOutline.enabled =
        !this.controller.beetle.extrusionShapeOutline.enabled;
    this.controller.beetle.extrusionShapeOutline.visibility =
        (this.controller.beetle.extrusionShapeOutline.enabled &&
            this.controller.beetle.extruding) ? 1 : 0;
    this.controller.changed();
};

BeetleDialogMorph.prototype.extrusionBaseEnabled = function () {
    return this.controller.beetle.extrusionShapeOutline.enabled;
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

BeetleDialogMorph.prototype.toggleFPV = function () {
    this.controller.camera.toggleFPV();
};

BeetleDialogMorph.prototype.fpvEnabled = function () {
    return this.controller.camera.fpvEnabled;
};

BeetleDialogMorph.prototype.exportSTL = function () {
    BABYLON.STLExport.CreateSTL(
        this.controller.beetleTrails,
        true, // download
        'beetle-trails', // filename
        undefined, // binary ?
        undefined, // little endian?
        undefined, // do not bake transform
        true // support instanced meshes
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
    this.extrusionShapeSelector = 'circle';
    this.lineTrail = null;
    this.extrusionShape = null;
    this.extrusionShapeOutline = null;
    this.updateExtrusionShapeOutline();
    this.extrusionShapeOutline.enabled = true;
    this.lastTransformMatrix = null;

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

    // any further extrusion will have to be a new mesh because of the new color
    if (this.extruding) {
        this.stopExtruding();
        this.extrudeToCurrentPoint();
    }

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

Beetle.prototype.newExtrusionShape = function (selector) {
    var path = [];
    if (selector instanceof List) {
        selector.asArray().forEach(p => {
            if (p instanceof List) {
                path.push(
                    new BABYLON.Vector3(Number(p.at(1)), 0, Number(p.at(2)))
                );
            }
        });
    } else {
        switch (selector) {
            case 'point':
                path.push(new BABYLON.Vector3(0,0,0));
                break;
            case 'triangle':
                path.push(new BABYLON.Vector3(-0.5, 0,  0));
                path.push(new BABYLON.Vector3(0.5,  0, 0));
                path.push(new BABYLON.Vector3(0, 0, Math.sqrt(2) / 2));
                path.push(new BABYLON.Vector3(-0.5, 0,  0));
                break;
            case 'square':
                path.push(new BABYLON.Vector3(-0.5, 0,  0.5));
                path.push(new BABYLON.Vector3(-0.5, 0, -0.5));
                path.push(new BABYLON.Vector3(0.5,  0, -0.5));
                path.push(new BABYLON.Vector3(0.5,  0,  0.5));
                path.push(new BABYLON.Vector3(-0.5, 0,  0.5));
                break;
            default:
            case 'circle':
                var radius = .5,
                    theta;
                for (theta = 0; theta < 2 * Math.PI; theta += Math.PI / 16) {
                    path.push(
                        new BABYLON.Vector3(
                            radius * Math.cos(theta),
                            0,
                            radius * Math.sin(theta),
                        )
                    );
                }
                path.push(path[0]);
                break;
        }
    }


    return path;
};

Beetle.prototype.updateExtrusionShapeOutline = function () {
    if (this.extrusionShapeOutline) {
        this.controller.scene.removeMesh(this.extrusionShapeOutline);
    }
    this.extrusionShape = this.newExtrusionShape(this.extrusionShapeSelector);
    if (this.extrusionShape.length > 1) {
        // not extruding points, let's draw a shape outline
        this.extrusionShapeOutline = BABYLON.MeshBuilder.CreateLines(
            'extrusionShape',
            {
                points: this.extrusionShape,
                useVertexAlpha: false
            },
            this.controller.scene
        );
        this.extrusionShapeOutline.parent = this.body;
        this.extrusionShapeOutline.scalingDeterminant = this.multiplierScale;
        this.extrusionShapeOutline.rotate(BABYLON.Axis.X, Math.PI / -2);
    }
    this.extrusionShapeOutline.visibility = this.extruding ? 1 : 0;
    this.controller.changed();
};

Beetle.prototype.extrudeToCurrentPoint = function () {
    this.extruding = true;
    if (this.extrusionShape.length === 1) {
        // draw a line
        var points = [];
        if (this.lineTrail) {
            points = this.lineTrail.points;
            this.lineTrail.dispose();
            this.controller.beetleTrails.pop();
        }
        points.push(this.body.position.clone());
        this.lineTrail = BABYLON.MeshBuilder.CreateLines(
            'lineTrail',
            {
                points: points,
                useVertexAlpha: false,
            },
            this.controller.scene
        );
        this.lineTrail.color = this.wings.material.diffuseColor.clone();
        this.lineTrail.points = points;
        this.controller.beetleTrails.push(this.lineTrail);
    } else {
        // extrude a polygon
        var currentTransformMatrix =
                this.extrusionShapeOutline.computeWorldMatrix(true);
        this.extrusionShapeOutline.visibility = 1;
        if (this.lastTransformMatrix) {
            var backFace =
                this.extrusionShape.map(
                    v =>
                        BABYLON.Vector3.TransformCoordinates(
                            v,
                            this.lastTransformMatrix
                        )
                    ),
                frontFace =
                    this.extrusionShape.map(v =>
                        BABYLON.Vector3.TransformCoordinates(
                            v,
                            currentTransformMatrix
                        )
                    ),
                numSides = this.extrusionShape.length,
                vertices = backFace.concat(frontFace).map(v => v.asArray()),
                faces = [];

            if (this.extrusionShape[0].equalsWithEpsilon(
                    this.extrusionShape[this.extrusionShape.length - 1],
                    0.001
            )) {
                // the first and last point are very close to each other, so
                // we assume the user is trying to build a closed volume
                faces.push([...Array(numSides).keys()].reverse()); // back
                faces.push([...Array(numSides).keys()].map(f => f + numSides));
            }

            // Add indices for all prism faces.
            // Since faces are always trapezoids, there are 4 vertices per face.
            for (var n = 0; n < numSides - 1; n++) {
                faces.push([
                    (n % numSides) + numSides,
                    n,
                    (n + 1) % numSides,
                    ((n + 1) % numSides) + numSides
                ]);
            }
            var prism = new BABYLON.MeshBuilder.CreatePolyhedron(
                'prism',
                {
                    custom: { vertex: vertices, face: faces },
                    sideOrientation: BABYLON.Mesh.DOUBLESIDE
                }
            );
            prism.material = BeetleController.Cache.getMaterial(
                this.wings.material.diffuseColor
            );
            prism.material.backFaceCulling = true;
            prism.material.wireframe = this.controller.wireframeEnabled;
            prism.visibility = this.controller.ghostModeEnabled ? .25 : 1

            this.controller.beetleTrails.push(prism);
        }
        this.lastTransformMatrix = currentTransformMatrix.clone();
        this.controller.changed();
    }
};

Beetle.prototype.stopExtruding = function () {
    this.extruding = false;
    this.lastTransformMatrix = null;
    this.extrusionShapeOutline.visibility = 0;
    this.lineTrail = null;
    this.controller.changed();
};

Beetle.prototype.show = function () {
    var extrusionShapeOutlineVisibility = this.extrusionShapeOutline.visibility;
    this.body.getChildren().forEach(mesh => mesh.visibility = 1);
    this.extrusionShapeOutline.visibility = extrusionShapeOutlineVisibility;
};

Beetle.prototype.hide = function () {
    var extrusionShapeOutlineVisibility = this.extrusionShapeOutline.visibility;
    this.body.getChildren().forEach(mesh => mesh.visibility = 0);
    this.extrusionShapeOutline.visibility = extrusionShapeOutlineVisibility;
};

Beetle.prototype.isVisible = function () {
    return this.wings ?
        this.wings.visibility === 1 :
        true;
};

// User facing methods, called from blocks

Beetle.prototype.move = function (axis, steps) {
    var scaledSteps = Number(steps) * this.multiplierScale,
        vector = new BABYLON.Vector3(
            axis === 'y' ? scaledSteps : 0,
            axis === 'z' ? scaledSteps : 0,
            axis === 'x' ? scaledSteps : 0
        );
    this.body.locallyTranslate(vector);
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
    this.updateExtrusionShapeOutline();
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
    stage.beetleController.clear();
});

SnapExtensions.primitives.set('bb_move(axis, steps)', function (axis, steps) {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.move(axis, steps);
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

SnapExtensions.primitives.set('bb_setextrusionbase(base)', function (base) {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    stage.beetleController.beetle.extrusionShapeSelector = base;
    stage.beetleController.beetle.updateExtrusionShapeOutline();
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

SnapExtensions.primitives.set('bb_beetleView()', function () {
    var stage = this.parentThatIsA(StageMorph);
    if (!stage.beetleController) { return; }
    return stage.beetleController.currentView();
});
