/* ES5 bootstrap: detect the features actually used, never browser names/versions. */
(function () {
  var canvas=document.createElement('canvas'),context=null;
  try {context=canvas.getContext && canvas.getContext('2d');} catch (ignore) {}
  var supported=Boolean(context && canvas.toDataURL && window.Promise && window.fetch &&
    window.indexedDB && window.File && window.Blob && window.URL && window.URL.createObjectURL &&
    window.URL.revokeObjectURL && window.Uint8Array && window.PointerEvent && window.crypto &&
    window.crypto.randomUUID && window.CustomEvent);
  var message='Для ручной примерки нужны функции, которых нет в вашем браузере. Обновите браузер или откройте сайт в актуальной версии Chrome, Safari, Firefox или Edge.';
  window.affrescoTryonCompat={supported:supported,message:message};
  if (!supported) {
    var button=document.getElementById('tryOnWall');
    if (button) {button.disabled=true;button.title=message;button.setAttribute('aria-describedby','tryonBrowserNotice');}
    var ids=['tryonBrowserNotice','tryonGlobalNotice','tryonCompatibilityMessage'];
    for (var i=0;i<ids.length;i++) {
      var notice=document.getElementById(ids[i]);
      if (notice) {notice.textContent=message;notice.hidden=false;}
    }
    var upload=document.getElementById('tryonUploadStep');
    if (upload) upload.hidden=true;
  }
})();
