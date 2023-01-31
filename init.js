var baseUrl = 'https://localhost:8000/'; // change when deploying

function loadSrc (url) {
    var url = baseUrl + url;
    return new Promise((resolve, reject) => {
        if (contains(SnapExtensions.scripts, url)) {
            reject();
        }
        scriptElement = document.createElement('script');
        scriptElement.onload = () => {
            SnapExtensions.scripts.push(url);
            resolve();
        };
        document.head.appendChild(scriptElement);
        scriptElement.src = url;
    });
};

loadSrc('three.min.js').then(
    ()=> loadSrc('OBJLoader.js')).then(
    ()=> loadSrc('STLExporter.js')).then(
    ()=> loadSrc('OrbitControls.js')).then(
    ()=> loadSrc('beetle.js')
);
