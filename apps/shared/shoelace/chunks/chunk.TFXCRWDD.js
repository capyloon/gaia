function o(t){let n=t.tagName.toLowerCase();return t.getAttribute("tabindex")==="-1"||t.hasAttribute("disabled")||t.hasAttribute("aria-disabled")&&t.getAttribute("aria-disabled")!=="false"||n==="input"&&t.getAttribute("type")==="radio"&&!t.hasAttribute("checked")||t.offsetParent===null||window.getComputedStyle(t).visibility==="hidden"?!1:(n==="audio"||n==="video")&&t.hasAttribute("controls")||t.hasAttribute("tabindex")||t.hasAttribute("contenteditable")&&t.getAttribute("contenteditable")!=="false"?!0:["button","input","select","textarea","a","audio","video","summary"].includes(n)}function f(t){var i,r;let n=[];function a(e){e instanceof HTMLElement&&(n.push(e),e.shadowRoot!==null&&e.shadowRoot.mode==="open"&&a(e.shadowRoot)),[...e.children].forEach(d=>a(d))}a(t);let u=(i=n.find(e=>o(e)))!=null?i:null,s=(r=n.reverse().find(e=>o(e)))!=null?r:null;return{start:u,end:s}}export{f as a};