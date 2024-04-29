
// Handle task modal logic.
function initTaskModal() {
    var taskModal = document.getElementById("NewTaskModal");
    var taskName = document.getElementById("taskName");
  
    taskModal.addEventListener("shown.bs.modal", () => {
      taskName.focus();
    });
  
    document
      .getElementById("newTaskForm")
      .addEventListener("submit", function (event) {
        // Prevent the form from submitting the info through the browser
        event.preventDefault();
        const formData = new FormData(this); // Get the form data
        console.log("submitting form data");
  
        //console log all data in formData
        for (var pair of formData.entries()) {
          console.log(pair[0] + ", " + pair[1]);
        }
  
        // if floorIDs or RoomIDs are not selected, display error on page and dont submit
        if (!formData.has("floorIDs") && !formData.has("roomIDs")) {
          // there is an element taskModalErrorField with the error message
          // it has a display: none style, remove it here:
          document.getElementById("taskModalErrorField").style.display = "block";
          return;
        }
  
        // Create the AJAX request
        fetch(this.getAttribute("action"), {
          method: "POST",
          body: formData,
          headers: {
            "X-CSRFToken": formData.get("csrfmiddlewaretoken"), // Handling CSRF token
          },
        })
          .then((response) => response.json())
          .then((data) => {
            if (data.status === "success") {
              console.log("Task added successfully");
              var taskModalElement = document.getElementById("NewTaskModal");
              const taskModal_bs = new bootstrap.Modal(taskModalElement, {
                backdrop: "static",
              });
  
              taskModal_bs.hide();
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
          floorCheckbox.indeterminate = false; // Make sure to remove indeterminate state if all are checked
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
      document.getElementById("taskModalErrorField").style.display = "none";
    }
  }
  