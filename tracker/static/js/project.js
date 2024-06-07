import { main } from "@popperjs/core";
import "../sass/project.scss";

/* Project specific Javascript goes here. */
document.addEventListener("DOMContentLoaded", function () {
  initTaskModal();
  initSidebar();
  initAddFloorForm();
  initAddRoomModal();
  initEditRoomForm();
  initEditFloorForm();
});

function initEditFloorForm() {
  const floorEmojiElements = document.querySelectorAll(".floor-emoji");

  floorEmojiElements.forEach(function (floorEmojiElement) {
    const floorEmojiValueElement = document.getElementById(
      floorEmojiElement.id + "-value"
    );

    attachEmojiPicker(floorEmojiElement, floorEmojiValueElement);
  });

  const editFloorExpandIconElements = document.querySelectorAll(
    ".edit-floor-expand-button"
  );

  if(!editFloorExpandIconElements){
    return;
  }

  editFloorExpandIconElements.forEach(function (editFloorExpandIconElement) {
    editFloorExpandIconElement.addEventListener("click", function () {
      console.log("clicked");
      const editFloorForm = document.getElementById(
        editFloorExpandIconElement.getAttribute("form-id")
      );

      if(!editFloorForm){
        return;
      }

      if (editFloorForm.style.display != "block") {
        editFloorForm.style.display = "block";
      } else {
        editFloorForm.style.display = "none";
      }
    });
  });
}

function initEditRoomForm() {
  const editRoomExpandIconElements = document.querySelectorAll(
    ".edit-room-expand-button"
  );

  if(!editRoomExpandIconElements){
    return;
  }

  editRoomExpandIconElements.forEach(function (editRoomExpandIconElement) {
    editRoomExpandIconElement.addEventListener("click", function () {
      const editRoomForm = document.getElementById(
        editRoomExpandIconElement.getAttribute("form-id")
      );

      if(!editRoomForm){
        return;
      }

      if (editRoomForm.style.display != "block") {
        editRoomForm.style.display = "block";
      } else {
        editRoomForm.style.display = "none";
      }
    });
  });
}

function initAddRoomModal() {
  const roomEmojiElements = document.querySelectorAll(".room-emoji");

  roomEmojiElements.forEach(function (roomEmojiElement) {
    const roomEmojiValueElement = document.getElementById(
      roomEmojiElement.id + "-value"
    );

    attachEmojiPicker(roomEmojiElement, roomEmojiValueElement);
  });

  const addRoomButtonElements = document.querySelectorAll(".add-room-button");

  addRoomButtonElements.forEach(function (addRoomButtonElement) {
    const formID = addRoomButtonElement.getAttribute("formID");
    const addRoomFormElement = document.getElementById(formID);

    addRoomButtonElement.addEventListener("click", function () {
      const display = addRoomFormElement.style.display;
      if (display === "block") {
        addRoomFormElement.style.display = "none";
      } else {
        addRoomFormElement.style.display = "block";
      }
    });
  });
}

function initAddFloorForm() {
  //* Attach emoji picker element
  const emojiTrigger = document.getElementById("floorEmoji");
  const emojiValueElement = document.getElementById("floorEmoji-value");
  attachEmojiPicker(emojiTrigger, emojiValueElement);

  //* Init expand button functionality
  const addFloorExpandButton = document.getElementById("add-floor-expand-btn");

  if (!addFloorExpandButton) {
    return;
  }

  addFloorExpandButton.addEventListener("click", function () {
    const addFloorForm = document.getElementById("addFloorForm");

    if (addFloorForm.style.display !== "block") {
      addFloorForm.style.display = "block";
    } else {
      addFloorForm.style.display = "none";
    }
  });
}

//* Whenever the triggerElement is clicked, make an emoji picker
//* appear next to it. Upon selecting an emoji, set the value of
//* targetElement to the emoji's native value.
function attachEmojiPicker(triggerElement, targetElement) {
  if (!triggerElement || !targetElement) {
    return;
  }

  var picker = document.createElement("div");
  picker.style.display = "none";

  var emojiPicker = new EmojiMart.Picker({
    onEmojiSelect: (emoji) =>
      handleEmojiSelect(emoji, triggerElement, targetElement),
  });

  picker.appendChild(emojiPicker);
  triggerElement.parentNode.insertBefore(picker, triggerElement.nextSibling);

  const showPicker = (triggerElement) => {
    var picker = triggerElement.nextSibling;

    if (picker) {
      picker.style.display = "block";
    }
  };

  // Function to handle emoji selection
  const handleEmojiSelect = (emoji, triggerElement, targetElement) => {
    triggerElement.innerHTML = emoji.native;
    targetElement.setAttribute("value", emoji.native);

    hidePicker(triggerElement);
  };

  // Function to hide the emoji picker
  const hidePicker = (triggerElement) => {
    var picker = triggerElement.nextSibling;

    if (picker) {
      picker.style.display = "none";
    }
  };

  // Attach the click event to the trigger element
  triggerElement.addEventListener("click", () => {
    picker = triggerElement.nextSibling;

    if (picker.style.display === "none") {
      showPicker(triggerElement);
    } else {
      hidePicker(triggerElement);
    }
  });
}

function initSidebar() {
  var userSidebarDropdownMenu = document.getElementById(
    "userSidebarDropdownMenu"
  );

  if (!userSidebarDropdownMenu) {
    return;
  }

  userSidebarDropdownMenu.addEventListener("click", function () {
    var dropdownMenu = userSidebarDropdownMenu.nextElementSibling;
    dropdownMenu.classList.toggle("show");
  });

  var sidebarFloorExpanders = document.querySelectorAll(
    ".sidebar-floor-expander"
  );

  sidebarFloorExpanders.forEach(function (sidebarFloorExpander) {
    var floorId = sidebarFloorExpander.getAttribute("floor-id");
    var collapseElement = document.querySelector(
      "#collapsible-sidebar-" + floorId
    );
    var bsCollapse = new bootstrap.Collapse(collapseElement, {
      toggle: false,
    });

    // Set the initial state based on the cookie
    var state = getCookie("sidebar-collapse-" + floorId);
    const expandSymbol = '<i class="bi bi-chevron-down"></i>';
    const collapseSymbol = '<i class="bi bi-chevron-up"></i>';

    if (state === "collapsed") {
      sidebarFloorExpander.innerHTML = expandSymbol;
      bsCollapse.hide();
    } else {
      sidebarFloorExpander.innerHTML = collapseSymbol;
      bsCollapse.show();
    }

    // Add click event listener
    sidebarFloorExpander.addEventListener("click", function () {
      if (this.innerHTML === expandSymbol) {
        this.innerHTML = collapseSymbol;
        bsCollapse.show();
        setCookie("sidebar-collapse-" + floorId, "expanded", 7); // Set cookie for 7 days
      } else {
        this.innerHTML = expandSymbol;
        bsCollapse.hide();
        setCookie("sidebar-collapse-" + floorId, "collapsed", 7); // Set cookie for 7 days
      }
    });
  });

  // check window width, if it is less than 630px console log "haha"
  const collapseSidebarButton = document.getElementById(
    "collapse-sidebar-button"
  );

  // select the second i element in collapsesidebarbutton
  const firstIconElement =
    collapseSidebarButton.querySelector("i:nth-child(1)");

  if (window.innerWidth < 630) {
    firstIconElement.classList.remove("bi-arrow-bar-left");
    firstIconElement.classList.add("bi-arrow-bar-right");
  }

  collapseSidebarButton.addEventListener("click", function () {
    // get element with id mainSidebar
    const mainSidebar = document.getElementById("mainSidebar");
    const sidebarHolder = document.getElementById("sidebarHolder");
    const sidebarElements = document.querySelectorAll(".sidebar-element");

    if (firstIconElement.classList.contains("bi-arrow-bar-left")) {
      if (window.innerWidth < 630) {
        document.body.classList.toggle("no-scroll");
      }
      // sidebar is collapsing
      // sed mainsidebar width to 0%
      mainSidebar.style.width = "0px";
      mainSidebar.style.display = "none";

      sidebarHolder.style.width = "0px";

      collapseSidebarButton.style.left = "5px";

      firstIconElement.classList.remove("bi-arrow-bar-left");
      firstIconElement.classList.add("bi-arrow-bar-right");

      // get all elements with class sidebar-element and set their display to none
      sidebarElements.forEach((element) => {
        element.style.display = "none";
      });
    } else {
      //sidebar is expanding
      if (window.innerWidth > 630) {
        mainSidebar.style.width = "250px";
        mainSidebar.style.display = "block";
        sidebarHolder.style.width = "250px";

        collapseSidebarButton.style.left = "260px";
      } else {
        document.body.classList.toggle("no-scroll");
        mainSidebar.style.width = "100vw";
        mainSidebar.style.display = "block";
        sidebarHolder.style.width = "100vw";

        collapseSidebarButton.style.left = "5px";
      }

      firstIconElement.classList.add("bi-arrow-bar-left");
      firstIconElement.classList.remove("bi-arrow-bar-right");

      sidebarElements.forEach((element) => {
        element.style.display = "block";
      });
    }
  });
}

// Handle task modal logic.
function initTaskModal() {
  var taskModal = document.getElementById("NewTaskModal");
  var taskName = document.getElementById("taskName");

  if (!taskModal || !taskName) {
    return;
  }

  taskModal.addEventListener("shown.bs.modal", () => {
    taskName.focus();
  });

  taskModal.addEventListener("hidden.bs.modal", function () {
    let backdrop = document.querySelector(".modal-backdrop");
    if (backdrop) {
      backdrop.remove(); // Remove the backdrop from the DOM entirely
    }
  });

  //* Handle data submission when the "Add Task" button is clicked.
  document
    .getElementById("newTaskForm")
    .addEventListener("submit", function (event) {
      event.preventDefault();
      const formData = new FormData(this); // Get the form data

      if (!formData.has("floorIDs") && !formData.has("roomIDs")) {
        showModalError();
        return;
      }

      // Create the AJAX request
      fetch(this.getAttribute("action"), {
        method: "POST",
        body: formData,
        headers: {
          "X-CSRFToken": formData.get("csrfmiddlewaretoken"),
        },
      })
        .then((response) => response.json())
        .then((data) => {
          if (data.status === "success") {
            console.log("Task added successfully?");

            //* find element with id close-task-modal-btn and click it
            const closeTaskModalBtn = document.getElementById(
              "close-task-modal-btn"
            );
            closeTaskModalBtn.click();

            this.reset();
          } else {
            alert("Error adding task. Please try again.");
          }
        })
        .catch((error) => {
          console.error("Error:", error);
          alert(
            "There was an error processing your request. Please try again."
          );
        });
    });

  /**
   ** Make it so whenever a floor checkbox is checked, all the room checkboxes also
   ** get checked and vice versa.
   */
  const floorCheckboxes = document.querySelectorAll(
    '.form-check-input[name="floorIDs"]'
  );
  floorCheckboxes.forEach(function (floorCheckbox) {
    floorCheckbox.addEventListener("change", function () {
      hideModalError();
      const floorId = this.value;
      const collapseElement = document.querySelector(`#collapse${floorId}`);
      const bsCollapse = new bootstrap.Collapse(collapseElement, {
        toggle: false, // Initialize but do not toggle
      });

      if (this.checked) {
        bsCollapse.show();
        collapseElement
          .querySelectorAll('.form-check-input[name="roomIDs"]')
          .forEach((roomCheckbox) => {
            roomCheckbox.checked = true;
          });
      } else {
        bsCollapse.hide();
        collapseElement
          .querySelectorAll('.form-check-input[name="roomIDs"]')
          .forEach((roomCheckbox) => {
            roomCheckbox.checked = false;
          });
      }
    });
  });

  const roomCheckboxes = document.querySelectorAll(
    '.form-check-input[name="roomIDs"]'
  );

  roomCheckboxes.forEach(function (roomCheckbox) {
    roomCheckbox.addEventListener("change", function () {
      hideModalError();

      const floorId = this.dataset.floorId;
      const floorCheckbox = document.getElementById(floorId);
      floorCheckbox.indeterminate = true;

      const allRoomCheckboxes = document.querySelectorAll(
        `[data-floor-id="${floorId}"]`
      );

      const isAnyRoomChecked = Array.from(allRoomCheckboxes).some(
        (cb) => cb.checked
      );
      const areAllRoomsChecked = Array.from(allRoomCheckboxes).every(
        (cb) => cb.checked
      );

      if (areAllRoomsChecked) {
        console.log("All rooms are checked");
        floorCheckbox.checked = true;
        floorCheckbox.indeterminate = false; // remove indeterminate state if all are checked
      } else if (isAnyRoomChecked) {
        console.log("Some rooms are checked");
        floorCheckbox.checked = false;
        floorCheckbox.indeterminate = true; // Set indeterminate state if some are checked
      } else {
        console.log("No rooms are checked");
        floorCheckbox.checked = false;
        floorCheckbox.indeterminate = false; // Clear indeterminate state if none are checked
      }
    });
  });

  function hideModalError() {
    var errorField = document.getElementById("taskModalErrorField");
    errorField.style.opacity = 1; // Ensure full opacity before hiding

    function fadeOut() {
      if (errorField.style.opacity > 0) {
        errorField.style.opacity -= 0.1;
      } else {
        clearInterval(fadeEffect);
        errorField.style.display = "none"; // Hide after transition
      }
    }

    var fadeEffect = setInterval(fadeOut, 50); // Adjust time to control speed of fade
  }

  function showModalError() {
    var errorField = document.getElementById("taskModalErrorField");
    errorField.style.display = "block"; // Make block before fading in
    errorField.style.opacity = 0; // Start from transparent

    function fadeIn() {
      if (errorField.style.opacity < 1) {
        errorField.style.opacity = parseFloat(errorField.style.opacity) + 0.1;
      } else {
        clearInterval(fadeEffect);
      }
    }

    var fadeEffect = setInterval(fadeIn, 50); // Adjust time to control speed of fade
  }
}

/* Cookie helpers */

// Function to set a cookie
function setCookie(name, value, days) {
  var expires = "";
  if (days) {
    var date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

// Function to get a cookie by name
function getCookie(name) {
  var nameEQ = name + "=";
  var ca = document.cookie.split(";");
  for (var i = 0; i < ca.length; i++) {
    var c = ca[i];
    while (c.charAt(0) == " ") c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}
