// Find from a photo: one tap, one search (SYC-522).
//
// Plain ES2019, no libraries. Comparing a photo takes several seconds and
// each person has only a few searches a day, so a second tap while the first
// is running must not send a second one. On submit this disables the button,
// says the search is running, and ignores any further submit. With no script
// the form is an ordinary POST, as before.
//
// The page comes back from the server as a new page. If the person returns
// with the back button the browser may restore this page as it was left, so
// "pageshow" puts the button back.
(function () {
  "use strict";

  var form = document.querySelector("form.findphoto");
  if (!form) return;
  var button = form.querySelector("button[type=submit]");
  var progress = document.getElementById("find-progress");
  if (!button || !progress) return;

  var label = button.textContent;
  var sent = false;

  form.addEventListener("submit", function (e) {
    if (sent) {
      e.preventDefault();
      return;
    }
    sent = true;
    button.disabled = true;
    button.textContent = "Comparing…";
    form.setAttribute("aria-busy", "true");
    progress.hidden = false;
    // A search that never comes back (Stop pressed, a flaky connection that
    // leaves this page showing) must not leave the button stuck: after a
    // minute, let the person try again.
    window.setTimeout(reset, 60000);
  });

  function reset() {
    sent = false;
    button.disabled = false;
    button.textContent = label;
    form.removeAttribute("aria-busy");
    progress.hidden = true;
  }

  window.addEventListener("pageshow", function (e) {
    if (e.persisted) reset();
  });
})();
