import "../sass/project.scss";

/* Project specific Javascript goes here. */
document.addEventListener("DOMContentLoaded", function () {
  initTaskModal();
  initSidebar();
  initAddFloorForm();
  initAddRoomModal();
});

function initAddRoomModal() {
  const roomEmojiElements = document.querySelectorAll(".room-emoji");

  roomEmojiElements.forEach(function (roomEmojiElement) {
    attachEmojiPicker(roomEmojiElement);
  });
}

function initAddFloorForm() {
  var collapseElementList = [].slice.call(document.querySelectorAll(".collapse-floor"));

  collapseElementList.forEach(function (collapseEl) {
      var collapseInstance = new bootstrap.Collapse(collapseEl, {
          toggle: false // Initialize without toggling state
      });

      collapseEl.addEventListener("show.bs.collapse", function (event) {
          console.log("Expanding...");
          this.previousElementSibling.querySelector(".toggle-icon").textContent = "-";
      });

      collapseEl.addEventListener("hide.bs.collapse", function (event) {
          console.log("Collapsing...");
          this.previousElementSibling.querySelector(".toggle-icon").textContent = "+";
      });
  });

  const emojiInput = document.getElementById("floorEmoji");
  attachEmojiPicker(emojiInput);
}

function attachEmojiPicker(input) {
  if (!input) {
    return;
  }

  const picker = new EmojiMart.Picker({
    onEmojiSelect: (emoji) => {
      input.value = emoji.native;
      pickerContainer.style.display = "none";
      document.getElementById("emojiOverlay").style.display = "none";
    },
    autoFocus: true,
  });

  const pickerContainer = document.createElement("div");
  pickerContainer.style.position = "absolute";
  pickerContainer.style.zIndex = "101";
  pickerContainer.style.display = "none";
  document.body.appendChild(pickerContainer);
  pickerContainer.appendChild(picker);

  input.addEventListener("focus", () => {
    pickerContainer.style.display = "flex";

    // Function to update the position of the picker
    function updatePosition() {
      if (document.activeElement === input) {
        const rect = input.getBoundingClientRect();
        const pickerHeight = picker.offsetHeight;
        const pickerWidth = picker.offsetWidth;

        // Adjust position based on viewport edges
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceRight = window.innerWidth - rect.right;

        pickerContainer.style.top = `${
          spaceBelow < pickerHeight ? rect.top - pickerHeight : rect.bottom
        }px`;
        pickerContainer.style.left = `${
          spaceRight < pickerWidth ? rect.right - pickerWidth : rect.left
        }px`;
      } else {
        pickerContainer.style.display = "none";
      }
    }

    updatePosition();
  });

  input.addEventListener("focus", () => {
    document.getElementById("emojiOverlay").style.display = "block";
    pickerContainer.style.display = "flex";
  });

  document.getElementById("emojiOverlay").addEventListener("click", () => {
    pickerContainer.style.display = "none";
    document.getElementById("emojiOverlay").style.display = "none";
  });

  input.addEventListener("blur", (event) => {
    setTimeout(() => {
      if (!document.activeElement.closest("em-emoji-picker")) {
        pickerContainer.style.display = "none";
        document.getElementById("emojiOverlay").style.display = "none";
      }
    }, 200);
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

  var sidebarFloorExpanders = document.querySelectorAll('.sidebar-floor-expander');

  //* Logic for handling the expand/collapse of the sidebar floor dropdowns
  sidebarFloorExpanders.forEach(function (sidebarFloorExpander) {
    sidebarFloorExpander.addEventListener("click", function () {
      var floorId = this.getAttribute("floor-id");
      var collapseElement = document.querySelector("#collapsible-sidebar-"+ floorId);
      var bsCollapse = new bootstrap.Collapse(collapseElement, {
        toggle: false,
      });

      const expandSymbol = "V";
      const collapseSymbol = "^";

      if (this.innerText === expandSymbol) {
        this.innerText = collapseSymbol;
        bsCollapse.show();
      } else {
        this.innerText = expandSymbol;
        bsCollapse.hide();
      }
    });
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

            var myModal = bootstrap.Modal.getOrCreateInstance(
              document.getElementById("NewTaskModal")
            );
            myModal.hide();

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

  const floorCheckboxes = document.querySelectorAll(
    '.form-check-input[name="floorIDs"]'
  );

  /**
   ** Make it so whenever a floor checkbox is checked, all the room checkboxes also
   ** get checked and vice versa.
   */
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
      console.log(Array.from(allRoomCheckboxes));
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
