var media_viewer_dialog;
var media_viewer_track;
var media_viewer_counter;
var media_viewer_items = [];
var media_viewer_index = 0;

function treat_posts() {
    ensure_media_viewer();

    for (let el of document.querySelectorAll(".date-relative")) {
        const timestamp = Number(el.textContent);
        el.textContent = get_relative_date(timestamp);
        el.title = get_absolute_date(timestamp);
    }
    for (content of document.querySelectorAll(".content")) {
        treat_post(content);
    }

    // click anywhere on a post to open it
    for (let post of document.querySelectorAll(".post[data-url]")) {
        post.addEventListener("click", function(e) {
            // don't navigate if clicking interactive elements
            let target = e.target;
            while (target && target !== this) {
                if (
                    target.tagName === "A" ||
                    target.tagName === "BUTTON" ||
                    target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.tagName === "SELECT" ||
                    target.tagName === "DIALOG" ||
                    target.tagName === "IMG" ||
                    target.tagName === "VIDEO" ||
                    target.tagName === "AUDIO" ||
                    target.tagName === "FORM" ||
                    target.closest("form") ||
                    target.closest(".post-actions")
                ) {
                    return;
                }
                target = target.parentElement;
            }
            window.location.href = this.dataset.url;
        });
    }

    // copy link buttons
    for (let btn of document.querySelectorAll(".copy-link")) {
        btn.addEventListener("click", async function(e) {
            e.stopPropagation();
            const url = window.location.origin + this.dataset.path;
            try {
                await navigator.clipboard.writeText(url);
                const original = this.textContent;
                this.textContent = "copied!";
                setTimeout(() => { this.textContent = original; }, 1200);
            } catch (err) {
                this.textContent = "failed";
                setTimeout(() => { this.textContent = "copy"; }, 1200);
            }
        });
    }
}

function ensure_media_viewer() {
    if (media_viewer_dialog) return;

    media_viewer_dialog = document.createElement("dialog");
    media_viewer_dialog.className = "media-viewer";
    media_viewer_dialog.innerHTML = `
        <button class="media-viewer-close" type="button" aria-label="close">×</button>
        <button class="media-viewer-nav prev" type="button" aria-label="previous">‹</button>
        <div class="media-viewer-viewport"><div class="media-viewer-track"></div></div>
        <button class="media-viewer-nav next" type="button" aria-label="next">›</button>
        <div class="media-viewer-count">1/1</div>
    `;

    document.body.appendChild(media_viewer_dialog);

    media_viewer_track = media_viewer_dialog.querySelector(".media-viewer-track");
    media_viewer_counter = media_viewer_dialog.querySelector(".media-viewer-count");

    media_viewer_dialog.querySelector(".media-viewer-close").onclick = () => media_viewer_dialog.close();
    media_viewer_dialog.querySelector(".media-viewer-nav.prev").onclick = () => media_viewer_go(-1);
    media_viewer_dialog.querySelector(".media-viewer-nav.next").onclick = () => media_viewer_go(1);

    const viewport = media_viewer_dialog.querySelector(".media-viewer-viewport");
    let touchStartX = 0;
    viewport.addEventListener("touchstart", (e) => {
        touchStartX = e.touches && e.touches[0] ? e.touches[0].clientX : 0;
    }, { passive: true });
    viewport.addEventListener("touchend", (e) => {
        const endX = e.changedTouches && e.changedTouches[0] ? e.changedTouches[0].clientX : 0;
        const delta = endX - touchStartX;
        if (Math.abs(delta) < 35) return;
        media_viewer_go(delta > 0 ? -1 : 1);
    }, { passive: true });

    media_viewer_dialog.addEventListener("click", (e) => {
        if (e.target === media_viewer_dialog) media_viewer_dialog.close();
    });

    media_viewer_dialog.addEventListener("close", () => {
        for (let video of media_viewer_dialog.querySelectorAll("video")) {
            video.pause();
        }
    });

    document.addEventListener("keydown", (e) => {
        if (!media_viewer_dialog.open) return;
        if (e.key === "ArrowLeft") media_viewer_go(-1);
        if (e.key === "ArrowRight") media_viewer_go(1);
        if (e.key === "Escape") media_viewer_dialog.close();
    });
}

function open_media_viewer(items, startIndex) {
    ensure_media_viewer();
    if (!items || items.length === 0) return;

    media_viewer_items = items;
    media_viewer_track.innerHTML = "";

    for (let item of items) {
        const slide = document.createElement("div");
        slide.className = "media-viewer-slide";

        if (item.type === "video") {
            const video = document.createElement("video");
            video.controls = true;
            video.preload = "metadata";
            video.src = item.src;
            slide.appendChild(video);
        } else {
            const img = document.createElement("img");
            img.src = item.src;
            img.loading = "eager";
            img.decoding = "async";
            slide.appendChild(img);
        }

        media_viewer_track.appendChild(slide);
    }

    media_viewer_index = Math.max(0, Math.min(items.length - 1, Number(startIndex) || 0));
    update_media_viewer();
    media_viewer_dialog.showModal();
}

function media_viewer_go(delta) {
    if (!media_viewer_items.length) return;
    media_viewer_index = (media_viewer_index + delta + media_viewer_items.length) % media_viewer_items.length;
    update_media_viewer();
}

function update_media_viewer() {
    media_viewer_track.style.transform = `translateX(-${media_viewer_index * 100}%)`;
    media_viewer_counter.textContent = `${media_viewer_index + 1}/${media_viewer_items.length}`;
}

function treat_post(content) {
    for (let image of content.querySelectorAll(".image")) {
        treat_image(image);
    }
    for (let album of content.querySelectorAll(".album")) {
        treat_album(album);
    }
    for (let audio of content.querySelectorAll(".audio")) {
        treat_audio(audio);
    }
}

function treat_image(block) {
    let image = block.querySelector("img");

    if (!image.getAttribute("loading")) image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");

    if (image.src.endsWith("-doodle")) {
        image.classList.add("doodle");
        image.removeAttribute("alt");
    } else {
        image.onclick = function() {
            open_media_viewer([{ type: "image", src: this.src }], 0);
        }.bind(image);
    }

    block.classList.add("not-loaded");
    image.onload = function() {
        this.classList.remove("not-loaded");
    }.bind(block);
}

function treat_album(block) {
    var wrapper = block.querySelector(".slides-wrapper");
    var slides = block.querySelector(".slides");

    block.dataset.slides_count = slides.children.length;
    block.dataset.slide_index = 1;

    // slide counter

    var counter = document.createElement("div");
    counter.className = "counter";

    // nav bubbles

    var bubbles = document.createElement("div");
    bubbles.className = "bubbles";
    for (let i=0; i<slides.children.length; i++) {
        var bubble = document.createElement("div");
        if (slides.children.length > 5) bubble.classList.add("hidden");
        bubbles.appendChild(bubble);
    }

    const viewerItems = [];
    for (let i=0; i<slides.children.length; i++) {
        const slide = slides.children[i];
        const img = slide.querySelector("img");
        const video = slide.querySelector("video source") || slide.querySelector("video");
        if (img && img.src && !img.src.endsWith("-doodle")) {
            viewerItems.push({ type: "image", src: img.src });
        } else if (video && video.src) {
            viewerItems.push({ type: "video", src: video.src });
        } else {
            viewerItems.push(null);
        }

        slide.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!viewerItems.length || !viewerItems[i]) return;
            const items = viewerItems.filter(Boolean);
            const start = items.findIndex((x) => x === viewerItems[i]);
            open_media_viewer(items, start < 0 ? 0 : start);
        });
    }

    wrapper.onscroll = function() {
        block.dataset.slide_index = Math.round(this.scrollLeft / this.clientWidth) + 1 || 1;
        counter.textContent = block.dataset.slide_index + "/" + block.dataset.slides_count;

        let index = Number(block.dataset.slide_index) - 1;
        let slides = Number(block.dataset.slides_count);
        for (let i=0; i<bubbles.children.length; i++) {
            let bubble = bubbles.children[i];
            if (i == index) {
                bubble.classList.add("selected");
            } else {
                bubble.classList.remove("selected");
            }
            if (slides > 5) {
                if (
                    index < slides - 2 && i == index + 3 ||
                    index > 2 && i == index - 3
                ) {
                    bubble.classList.remove("hidden");
                    bubble.classList.add("small");
                } else {
                    bubble.classList.remove("small");
                    if (i < index - 2.5 || i > index + 2.5) {
                        bubble.classList.add("hidden");
                    } else {
                        bubble.classList.remove("hidden");
                    }
                }
            }
        }
    }

    block.appendChild(counter);
    block.appendChild(bubbles);

    wrapper.onscroll();
}

function treat_audio(block) {
    var audio = block.querySelector("audio");

    var controls = document.createElement("div");
    controls.className = "controls";
    controls.innerHTML = `
        <button class="play-button icon-button paused">
            <img class="play-icon" src="/res/play.svg" title="play" alt="play" draggable="false">
            <img class="pause-icon" src="/res/pause.svg" title="pause" alt="pause" draggable="false">
        </button>
        <input type="range" min="0" max="100" value="0" disabled="true">
        <div class="time">0:00 / 0:00</div>
        <a class="download-button icon-button" href="${audio.querySelector('source').src}"><img src="/res/download.svg" title="download" alt="download" draggable="false"></a>
    `;

    audio.classList.add("hidden");
    block.prepend(controls);

    var play_button = controls.querySelector(".play-button");
    play_button.onclick = () => {
        if (play_button.classList.contains("paused")) {
            if (audio.currentTime >= audio.duration) {
                audio.pause();
                audio.currentTime = 0.0001;
            }
            audio.play();
        } else {
            audio.pause();
        }
    }

    audio.onplay = () => {
        play_button.classList.remove("paused");
        play_button.classList.add("playing");
    }

    audio.onended = audio.onpause = () => {
        play_button.classList.add("paused");
        play_button.classList.remove("playing");
    }

    var seeking = false;

    var time_element = controls.querySelector(".time");
    audio.ontimeupdate = audio.onloadedmetadata = audio.ondurationchange = () => {
        if (!isNaN(audio.duration) && audio.duration != Infinity && audio.duration > 0.0001) slider.disabled = false;
        if (play_button.classList.contains("playing")) {
            if (audio.duration == Infinity) {
                slider.value = 0;
            } else if (!isNaN(audio.duration) && audio.duration > 0.0001 && !seeking) {
                slider.value = (audio.currentTime / audio.duration) * 100;
            }
        }
        time_element.textContent = get_audio_time_string(audio.currentTime) + " / " + get_audio_time_string(audio.duration == Infinity ? 0 : audio.duration);
    };

    var slider = controls.querySelector("input[type='range']");
    slider.onmousedown = slider.ontouchstart = () => { seeking = true; }
    slider.onmouseup = slider.ontouchend = () => { seeking = false; }
    slider.onchange = () => {
        audio.currentTime = audio.duration * (slider.value / 100) || 0;
        time_element.textContent = get_audio_time_string(audio.currentTime) + " / " + get_audio_time_string(audio.duration);
    }
}

function get_audio_time_string(seconds) {
    seconds = Math.floor(seconds);

    var sec = seconds % 60;
    var min = Math.floor(seconds / 60) % 60;
    var hour = Math.floor(seconds / 60 / 60);
    if (sec < 10) sec = '0'+sec;
    if (hour > 0 && min < 10) min = '0'+min;

    if (hour > 0) {
        return hour + ':' + min + ':' + sec;
    } else {
        return min + ':' + sec;
    }
}

function get_absolute_date(timestamp) {
    var date = new Date(Number(timestamp));

    var month = format_number(date.getMonth() + 1);
    var day = format_number(date.getDate());
    var hour = format_number(date.getHours());
    var min = format_number(date.getMinutes());
    var sec = format_number(date.getSeconds());

    return date.getFullYear() + '/' + month + '/' + day + ' ' + hour + ':' + min + ':' + sec
}

function get_relative_date(timestamp) {
    if (timestamp == 0) return "soon";

    var date;

    var current_date = new Date();
    var post_date = new Date(Number(timestamp));

    let a = get_absolute_date(timestamp).split(" ");
    let hours = post_date.getHours();

    var ampm_time = 
        (hours > 12 ? hours - 12 : hours) +
        (hours >= 12 ? "pm" : "am");
    if (ampm_time == "0am") ampm_time = "midnight";

    let current_year = current_date.getFullYear();
    if (current_year == post_date.getFullYear()) {
        if (current_date.getMonth() == post_date.getMonth()) {
            let current_day = current_date.getDate();
            if (current_day == post_date.getDate()) {
                var seconds_elapsed = (current_date - post_date) / 1000;
                var minutes_elapsed = seconds_elapsed / 60;
                var hours_elapsed = minutes_elapsed / 60;

                if (hours_elapsed < 1) {
                    if (minutes_elapsed < 1) {
                        if (seconds_elapsed < 5) {
                            date = "now"
                        } else {
                            date = Math.floor(seconds_elapsed) + " seconds ago"
                        }
                    } else {
                        if (minutes_elapsed < 2) {
                            date = "a minute ago";
                        } else {
                            date = Math.floor(minutes_elapsed) + " minutes ago";
                        }
                    }
                } else {
                    if (hours_elapsed < 2) {
                        date = "an hour ago";
                    } else {
                        date = ampm_time;
                    }
                }
            } else {
                var days_passed = current_day - Number(post_date.getDate());
                if (days_passed == 1) {
                    date = ampm_time + ", yesterday";
                } else if (days_passed < 7) {
                    var weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
                    date = ampm_time + ", " + weekdays[post_date.getDay()];
                } else {
                    date = ampm_time + ", " + days_passed + " days ago";
                }
            }
        } else {
            date = (post_date.getMonth() + 1) + "/" + post_date.getDate();
        }
    } else {
        var years_passed = current_year - post_date.getFullYear();
        if (years_passed == 1) {
            date = "last year";
        } else {
            date = years_passed + " years ago";
        }
    }

    return date;
}

function format_number(n) {
    if (n < 10) return '0' + n;
    return n;
}