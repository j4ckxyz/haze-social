const max_file_size_mb = 100;
const max_file_count = 10;
const max_transfer_size = 1000 * 1000 * 1000;

const replying_to = document.getElementById("replying_to").textContent;

const block_templates = {
  rec: document.getElementById("rec-block-template"),
  draw: document.getElementById("draw-block-template"),

  text: document.getElementById("text-block-template"),
  image: document.getElementById("image-block-template"),
  video: document.getElementById("video-block-template"),
  audio: document.getElementById("audio-block-template"),
  album: document.getElementById("album-block-template"),
};

const media_tags = ["image", "video", "audio"];

var file_of_objecturl = {};

window.onbeforeunload = () => {
  if (
    !document.body.classList.contains("publishing") &&
    post_builder.getElementsByClassName("block").length > 0
  ) {
    return "discard post?";
  }
};

// ios safari requires change function to be applied through javascript

const file_input = document.querySelector("input[type='file']");
file_input.onchange = async () => {
  await add_files(file_input.files);
  file_input.value = "";
};

// build post

const post_builder = document.getElementById("post-builder");
var reordering_post = false;

function add_post_block(type) {
  var template = block_templates[type];
  var clone = template.content.firstElementChild.cloneNode(true);
  var element = post_builder.appendChild(clone);

  if (type == "text") {
    const textarea = element.querySelector("textarea");
    setup_mention_autocomplete(textarea);
    textarea.focus();
  } else if (type == "rec") {
    start_recording(element);
  } else if (type == "draw") {
    setup_canvas(element);
  } else if (type == "audio") {
    treat_audio(element);
  }

  return element;
}

function setup_mention_autocomplete(textarea) {
  if (!window.mention_suggestions_el) {
    window.mention_suggestions_el = document.createElement("div");
    window.mention_suggestions_el.className = "mention-suggestions hidden";
    document.body.appendChild(window.mention_suggestions_el);
  }

  let active_users = [];
  let active_index = 0;
  let debounce;

  textarea.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(update_suggestions, 150);
  });

  textarea.addEventListener("keydown", (e) => {
    if (window.mention_suggestions_el.classList.contains("hidden")) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      active_index = Math.min(active_index + 1, active_users.length - 1);
      render_suggestions();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active_index = Math.max(active_index - 1, 0);
      render_suggestions();
    } else if (e.key === "Enter" || e.key === "Tab") {
      if (active_users[active_index]) {
        e.preventDefault();
        insert_mention(active_users[active_index].username);
      }
    } else if (e.key === "Escape") {
      hide_suggestions();
    }
  });

  textarea.addEventListener("blur", () => {
    setTimeout(hide_suggestions, 150);
  });

  async function update_suggestions() {
    const mention = get_active_mention(textarea);
    if (!mention || mention.query.length < 1) {
      hide_suggestions();
      return;
    }

    const res = await fetch(
      "/api/users/search?q=" + encodeURIComponent(mention.query),
    )
      .then((res) => res.json())
      .catch((err) => console.log(err));

    active_users = res && res.users ? res.users : [];
    active_index = 0;

    if (active_users.length === 0) {
      hide_suggestions();
      return;
    }

    position_suggestions(textarea);
    render_suggestions();
  }

  function render_suggestions() {
    window.mention_suggestions_el.innerHTML = "";
    for (let i = 0; i < active_users.length; i++) {
      const user = active_users[i];
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "@" + user.username;
      if (i === active_index) button.classList.add("selected");
      button.onmousedown = (e) => {
        e.preventDefault();
        insert_mention(user.username);
      };
      window.mention_suggestions_el.appendChild(button);
    }
    window.mention_suggestions_el.classList.remove("hidden");
  }

  function insert_mention(username) {
    const mention = get_active_mention(textarea);
    if (!mention) return;

    textarea.setRangeText(
      "@" + username + " ",
      mention.start,
      mention.end,
      "end",
    );
    textarea.focus();
    hide_suggestions();
  }
}

function get_active_mention(textarea) {
  const end = textarea.selectionStart;
  const before_caret = textarea.value.slice(0, end);
  const match = before_caret.match(/(^|[^\w/])@([a-zA-Z0-9_-]{0,30})$/);
  if (!match) return null;

  return {
    query: match[2],
    start: end - match[2].length - 1,
    end: end,
  };
}

function position_suggestions(textarea) {
  const rect = textarea.getBoundingClientRect();
  window.mention_suggestions_el.style.left = rect.left + "px";
  window.mention_suggestions_el.style.top = rect.bottom + 4 + "px";
  window.mention_suggestions_el.style.width = Math.min(rect.width, 280) + "px";
}

function hide_suggestions() {
  if (window.mention_suggestions_el) {
    window.mention_suggestions_el.classList.add("hidden");
  }
}

function post_to_markdown(preview) {
  var markdown = "";
  var files = [];

  var blocks = post_builder.getElementsByClassName("block");
  for (let i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    var src = block.dataset.src;
    var file_index = files.length;

    switch (block.dataset.type) {
      case "text":
        markdown += block.querySelector("textarea").value + "\n\n";
        break;
      case "image":
        files[file_index] = file_of_objecturl[src];
        markdown += `![image](${preview ? src.replace("blob:", "") : "media/" + file_index})\n\n`;
        break;
      case "audio":
        files[file_index] = file_of_objecturl[src];
        markdown += `![audio](${preview ? src.replace("blob:", "") : "media/" + file_index})\n\n`;
        break;
      case "video":
        files[file_index] = file_of_objecturl[src];
        markdown += `![video](${preview ? src.replace("blob:", "") : "media/" + file_index})\n\n`;
        break;
      case "album":
        markdown += "![album](\n";
        var slides = block.querySelector(".slides");
        for (let i = 0; i < slides.children.length; i++) {
          let b = slides.children[i];

          file_index = files.length;
          files[file_index] = file_of_objecturl[b.dataset.src];

          markdown += `    ![${b.dataset.type}](${preview ? b.dataset.src.replace("blob:", "") : "media/" + file_index})`;
          if (i < slides.children.length - 1) markdown += ",\n";
        }
        markdown += "\n)\n\n";
        break;
    }
  }

  return {
    markdown: markdown.trim(),
    files: files,
  };
}

// publish post

const confirm_dialog = document.getElementById("confirm-dialog");
const upload_dialog = document.getElementById("upload-dialog");

async function upload_post() {
  upload_dialog.showModal();

  var post = post_to_markdown();

  var form = new FormData();
  form.append("post", post.markdown);

  for (let file of post.files) form.append("files", file);

  form.append("replying_to", replying_to);

  var size = 0;
  for (var e of form.entries()) {
    size += e[0].length;
    if (e[1] instanceof Blob) size += e[1].size;
    else size += e[1].length;
  }
  if (size > max_transfer_size) {
    alert(
      "this post exceeds the max upload size of 1 GB. please make your post smaller!",
    );
    return;
  }

  var endpoint = localStorage.getItem("endpoint");
  if (!endpoint) {
    var service_worker = await navigator.serviceWorker.ready;
    let push = await service_worker.pushManager
      .subscribe({
        userVisibleOnly: true,
        applicationServerKey: VAPID_KEY,
      })
      .catch((err) => console.error(err));
    if (push) {
      localStorage.setItem("endpoint", push.endpoint);
      endpoint = push.endpoint;
    }
  }

  form.append("endpoint", endpoint);

  const endpoint_el = document.getElementById("publish_endpoint");
  const target = endpoint_el ? endpoint_el.value : "/publish";

  var json = await fetch(target, {
    method: "POST",
    body: form,
  })
    .then((res) => res.json())
    .catch((err) => console.log(err));

  upload_dialog.close();

  if (json) {
    if (json.path) {
      document.body.classList.add("publishing");
      location.href = "/" + json.path;
    } else {
      alert(
        "weird! your post failed to upload. please inform quewon as this shouldn't be happening.",
      );
    }
  } else {
    alert("you're offline (or the server is). try again later!");
  }
}

var filereader = new FileReader();

function get_file_block_src_element(block) {
  let type = block.dataset.type;
  switch (type) {
    case "image":
      if (block.classList.contains("draw")) {
        return null;
      } else {
        return block.querySelector("img");
      }
    case "video":
    case "audio":
      return block.querySelector("source");
  }
  return null;
}

async function add_files(files) {
  if (files.length + Object.keys(file_of_objecturl).length > max_file_count) {
    alert(`you can only attach up to ${max_file_count} files in a post!`);
    return;
  }

  var new_blocks = [];

  post_builder.classList.add("adding-files");

  for (let file of files) {
    var block = await add_file(file);
    if (block) {
      new_blocks.push(block);
      if (new_blocks.length > 1) block.remove();
    }
  }

  if (new_blocks.length > 1) {
    // create album
    var album = add_post_block("album");
    var slides = album.querySelector(".slides");

    for (let block of new_blocks) {
      block.classList.remove("block");
      block.querySelector(".options").remove();
      slides.appendChild(block);
    }

    treat_album(album);
  }

  post_builder.classList.remove("adding-files");
}

async function add_file(file) {
  if (file.size > max_file_size_mb * 1000 * 1000) {
    alert(`file too large :(\n(max file size: ${max_file_size_mb} MB)`);
    return;
  }

  const type = file.type.split("/")[0];

  if (block_templates[type]) {
    var block = add_post_block(type);

    if (file.type == "image/heic") {
      var result = await heic2any({
        blob: file,
        toType: "image/jpeg",
      });
      file = new File([result], file.name.split(".")[0] + ".jpg");
    }

    var object_url = URL.createObjectURL(file);
    var element_with_src;

    switch (type) {
      case "video":
      case "audio":
        var source = block.querySelector("source");
        source.src = object_url;
        source.type = file.type;
        element_with_src = source;
        break;
      case "image":
        element_with_src = get_file_block_src_element(block);
        element_with_src.src = object_url;
        break;
    }

    block.dataset.src = object_url;
    file_of_objecturl[object_url] = file;

    return block;
  } else {
    alert("file type " + file.type + " not supported :(");
  }
}

function all_file_blocks() {
  var query = "";
  for (let tag of media_tags) {
    query += "[data-type='" + tag + "'],";
  }
  query = query.slice(0, -1);
  return post_builder.querySelectorAll(query);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// recording

function start_recording(block) {
  var stop_button = block.querySelector("button");
  var time_counter = block.querySelector(".time");

  if (navigator.mediaDevices.getUserMedia) {
    let chunks = [];
    let time = 0;
    let onSuccess = (stream) => {
      let mimeType;
      if (MediaRecorder.isTypeSupported("audio/mpeg")) {
        mimeType = "audio/mpeg";
      } else if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      }

      const recorder = new MediaRecorder(stream, {
        mimeType: mimeType,
        audio: true,
        video: false,
        noiseSuppression: false,
        echoCancellation: false,
      });
      block.classList.add("recording");
      recorder.start();

      stop_button.focus();

      var interval = setInterval(() => {
        time += 1;
        time_counter.textContent = get_audio_time_string(time);
      }, 1000);

      stop_button.onclick = () => {
        recorder.stop();
        block.classList.remove("recording");
      };

      recorder.onstop = () => {
        clearInterval(interval);

        // create block
        var audio_block = add_post_block("audio");
        block.after(audio_block);
        block.remove();

        const blob = new Blob(chunks);
        chunks = [];

        var extension = "";
        switch (recorder.mimeType) {
          case "audio/mpeg":
            extension = ".mp3";
            break;
          default:
            if (recorder.mimeType.trim() == "") {
              extension = ".webm";
            } else {
              extension = "." + recorder.mimeType.split("/")[1].split(";")[0];
            }
            break;
        }

        const url = URL.createObjectURL(blob);
        file_of_objecturl[url] = new File([blob], "recording" + extension, {
          type: recorder.mimeType,
        });
        audio_block.dataset.src = url;

        let source = audio_block.querySelector("source");
        source.src = url;
        source.type = recorder.mimeType;
      };

      recorder.ondataavailable = (e) => {
        chunks.push(e.data);
      };
    };

    let onError = (error) => {
      console.error(error);
      alert("error occured while recording :(");
      block.remove();
    };

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(onSuccess, onError);
  } else {
    alert("recording not supported on this browser");
    block.remove();
  }
}

// drawing

function setup_canvas(block) {
  var canvas = block.querySelector("canvas");
  var pencil = block.querySelector(".pencil");
  var eraser = block.querySelector(".eraser");

  var context = canvas.getContext("2d");

  var mode = 0;
  var mousedown = false;
  var radius = [5, 3];
  var prev_point;

  context.lineCap = "round";
  context.fillStyle = context.strokeStyle = "black";

  pencil.onclick = () => {
    eraser.classList.remove("selected");
    pencil.classList.add("selected");
    mode = 1;
    context.lineWidth = radius[mode] * 1.2;
    context.globalCompositeOperation = "source-over";
  };
  eraser.onclick = () => {
    pencil.classList.remove("selected");
    eraser.classList.add("selected");
    mode = 0;
    context.lineWidth = radius[mode] * 2;
    context.globalCompositeOperation = "destination-out";
  };

  pencil.onclick();

  canvas.onmousedown = canvas.ontouchstart = (e) => {
    mousedown = true;
    canvas.classList.add("drawing");

    let touch = e.touches ? e.touches[0] : e;
    let rect = canvas.getBoundingClientRect();
    let x = touch.pageX - rect.left;
    let y = touch.pageY - rect.top - document.documentElement.scrollTop;
    draw(x, y);
  };

  document.addEventListener("mouseup", drawend);
  window.addEventListener("blur", drawend);
  canvas.ontouchend = drawend;

  function drawend() {
    canvas.classList.remove("drawing");

    if (prev_point) {
      let x = prev_point.x;
      let y = prev_point.y;
      prev_point = null;
      draw(x, y);
    }

    mousedown = false;
    prev_point = null;

    // turn canvas into blob
    block.classList.add("saving");
    canvas.toBlob((blob) => {
      if (block.dataset.src in file_of_objecturl)
        delete file_of_objecturl[block.dataset.src];
      const url = URL.createObjectURL(blob);
      file_of_objecturl[url] = new File([blob], "doodle");
      block.dataset.src = url;
      block.classList.remove("saving");
    });
  }
  document.addEventListener("mousemove", (e) => {
    if (mousedown) {
      let rect = canvas.getBoundingClientRect();
      let x = e.pageX - rect.left;
      let y = e.pageY - rect.top - document.documentElement.scrollTop;
      draw(x, y);
    }
  });
  canvas.addEventListener("touchmove", (e) => {
    if (mousedown) {
      let rect = canvas.getBoundingClientRect();
      let x = e.touches[0].pageX - rect.left;
      let y =
        e.touches[0].pageY - rect.top - document.documentElement.scrollTop;
      draw(x, y);
      e.preventDefault();
    }
  });

  function draw(x, y) {
    if (prev_point) {
      context.beginPath();
      context.moveTo(prev_point.x, prev_point.y);
      context.lineTo(x, y);
      context.stroke();
    } else {
      context.beginPath();
      context.arc(x, y, radius[mode], 0, Math.PI * 2);
      context.fill();
    }

    prev_point = { x: x, y: y };
  }

  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
  });
}

// preview

const preview_dialog = document.getElementById("post-preview-dialog");
var previousMarkdown;

async function preview_post() {
  const markdown = post_to_markdown(true).markdown;
  if (markdown !== previousMarkdown) {
    if (preview_dialog.querySelector(".content"))
      preview_dialog.querySelector(".content").remove();

    var form = new FormData();
    form.append("post", markdown);
    var res = await fetch("/api/preview", {
      method: "POST",
      body: form,
    })
      .then((res) => res.json())
      .catch((err) => console.log(err));

    if (res.post.trim() !== "") {
      var content = document.createElement("div");
      content.className = "content";
      content.innerHTML = res.post;
      for (let image of content.querySelectorAll(".image")) {
        const srcel = image.querySelector("img");
        srcel.src = srcel.src.replaceAll(
          location.origin,
          `blob:${location.origin}`,
        );
      }
      for (let media of content.querySelectorAll(".audio, .video")) {
        const srcel = media.querySelector("source");
        srcel.src = srcel.src.replaceAll(
          location.origin,
          `blob:${location.origin}`,
        );
      }
      preview_dialog.querySelector("table").after(content);
      treat_post(content);
    }
  }
  previousMarkdown = markdown;

  preview_dialog.showModal();
}
