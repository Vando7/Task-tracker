var fieldsLoaded = 0;

var noChangesCounter = 0;
var updateIntervalSeconds = 1;

//* Keep a backup of task data in memory that can be helpful.
var global_pending_tasks = null;
var global_done_tasks = null;

let latestTimestamp = null;



document.addEventListener("DOMContentLoaded", function() {
  console.log("DOMContentLoaded");

  loadElements();
});



/***********************************8
 * UPDATE TASKS
 */
async function updateTaskList() {
  const pending_tasks = await fetchTasks(false);
  const done_tasks = await fetchTasks(true);

  // show/hide display banner
  if (pending_tasks.length === 0) {
    document.getElementById("no-tasks-congrats").style.display = "block";
  } else {
    document.getElementById("no-tasks-congrats").style.display = "none";
  }

  allTasks = pending_tasks.concat(done_tasks);
  updateTasksOnPage(allTasks);
  addMissingTasks(allTasks);
  removeDeletedTasks(allTasks);
  initialize_fields();
}



function addMissingTasks(tasks) {
  tasks.forEach((task) => {
    const taskCard = document.getElementById(`task-${task.id}`);

    if(taskCard) {
      return;
    }

    if(task.status == "done") {
      renderTasks([task], "done_tasks_holder");
    } else {
      renderTasks([task], "pending_tasks_holder");
    }
  });
}



// Hide any tasks that are no longer in the database
function removeDeletedTasks(tasks) {
  const elements = document.querySelectorAll(".task-holder");

  // 2. loop through the elements and check if they are in the list of tasks
  elements.forEach((element) => {
    const taskId = element.getAttribute("id");

    if(!taskId) {
      return;
    }

    const task = tasks.find((task) => 'task-' + task.id === taskId);

    if(!task) {
      element.remove();
    }
  });
}


function updateTasksOnPage(tasks) {
  /*
   * Update the task fields in the dom for all tasks given a list of tasks from the server..
   */

  tasks.forEach((task) => {
    const taskCard = document.getElementById(`task-${task.id}`);

    if (!taskCard) {
      // uncomment to debug
      // console.log("Task card not found");
      return;
    }

    // check if the last modified date is different from the one in the task card
    const pageTaskModifiedDate = taskCard.querySelector(
      ".task-modified-date-value-actual"
    ).textContent;

    // uncomment to debug
    // console.log("pageTaskModifiedDate: " + pageTaskModifiedDate);
    // console.log("task.modified_date: " + task.modified_date);

    if (pageTaskModifiedDate == task.modified_date) {
      // uncomment to debug
      //console.log("task " + task.id + " has not been modified continuing");
      return;
    }

    // uncomment to debug
    //console.log("task " + task.id + " has been modified - updating");


    //* Show or hide the repeatable task icon
    const recurringTaskIcon = taskCard.querySelector(".repeatable-task-icon");

    if(task.status == "done") {
      taskCard.querySelector(".completed-task-icon").style.display = "inline";
    } else {
      taskCard.querySelector(".completed-task-icon").style.display = "none";
    }

    // Display the repeatable task icon only for tasks that are recurring and
    // not done.
    if(task.type == "recurring") {
      if(task.status == "done") {
        recurringTaskIcon.style.display = "none";
      } else {
        recurringTaskIcon.style.display = "inline";
      }
    } else{
      recurringTaskIcon.style.display = "none";
    }

    //* Set the correct shadow class for the task
    //* This influences the colorful shadows that appear under the task card
    if(task.category == "urgent") {
      var shadowClassElement = taskCard.querySelector(".shadow");
      var oldValue = "shadow";

      if(!shadowClassElement) {
        shadowClassElement = taskCard.querySelector(".urgent-task");
        oldValue = "urgent-task";
      }

      if(!shadowClassElement) {
        shadowClassElement = taskCard.querySelector(".special-task");
        oldValue = "special-task";
      }

      if(task.status !== "done") {
        shadowClassElement.classList.remove(oldValue);
        shadowClassElement.classList.add("urgent-task");
        taskCard.querySelector(".task-category-visual").innerHTML = "Urgent";
        taskCard.querySelector(".task-category-visual").classList.add("urgent-task-visual");

        var cardBodyElement = taskCard.querySelector(".card-body");
        cardBodyElement.style.paddingTop = "0px";
      }

      if(task.status == "done") {

        shadowClassElement.classList.remove(oldValue);
        shadowClassElement.classList.add("shadow");
        taskCard.querySelector(".task-category-visual").innerHTML = "";
        taskCard.querySelector(".task-category-visual").classList.remove("urgent-task-visual");

        var cardBodyElement = taskCard.querySelector(".card-body");
        cardBodyElement.style.paddingTop = "10px";
      }
    }

    if(task.category == "special") {
      var shadowClassElement = taskCard.querySelector(".shadow");
      var oldValue = "shadow";

      if(!shadowClassElement) {
        shadowClassElement = taskCard.querySelector(".urgent-task");
        oldValue = "urgent-task";
      }

      if(!shadowClassElement) {
        shadowClassElement = taskCard.querySelector(".special-task");
        oldValue = "special-task";
      }

      if(task.status !== "done" )  {

        shadowClassElement.classList.remove(oldValue);
        shadowClassElement.classList.add("special-task");
        taskCard.querySelector(".task-category-visual").innerHTML = "Special";
        taskCard.querySelector(".task-category-visual").classList.add("special-task-visual");

        var cardBodyElement = taskCard.querySelector(".card-body");
        cardBodyElement.style.paddingTop = "0px";
      }

      if (task.status == "done") {
        shadowClassElement.classList.remove(oldValue);
        shadowClassElement.classList.add("shadow");
        taskCard.querySelector(".task-category-visual").innerHTML = "";
        taskCard.querySelector(".task-category-visual").classList.remove("special-task-visual");

        var cardBodyElement = taskCard.querySelector(".card-body");
        cardBodyElement.style.paddingTop = "10px";
      }
    }

    if(task.category == "normal") {
      var shadowClassElement = taskCard.querySelector(".shadow");
      var oldValue = "shadow";

      if(!shadowClassElement) {
        shadowClassElement = taskCard.querySelector(".urgent-task");
        oldValue = "urgent-task";
      }

      if(!shadowClassElement) {
        shadowClassElement = taskCard.querySelector(".special-task");
        oldValue = "special-task";
      }

      shadowClassElement.classList.remove(oldValue);
      shadowClassElement.classList.add("shadow");
      taskCard.querySelector(".task-category-visual").innerHTML = "";
      taskCard.querySelector(".task-category-visual").classList.remove("special-task-visual");

      var cardBodyElement = taskCard.querySelector(".card-body");
      cardBodyElement.style.paddingTop = "10px";
    }

    //* Hide/show visible due date if value is not set
    if (task.due_date == null || task.due_date == "") {
      taskCard.querySelector(".due-period-visible").style.display = "none";
    } else {
      taskCard.querySelector(".due-period-visible").style.display = "inline";
    }

    // Iterate over task rooms and remove/add room deleters
    // remove existing room removers
    var roomDeleteHolder = taskCard.querySelector(".room-delete-holder");
    roomDeleteHolder.innerHTML = "";
    // add new room removers
    renderRooms(taskCard, task);

    // Handle each task field, set proper values.
    const taskFields = taskCard.querySelectorAll(".task-field");
    taskFields.forEach((taskField) => {
      const taskFieldValue = taskField.textContent;

      console.log("UPDATING TASK FIELD + " + taskField.getAttribute("data-field-name"));
      console.log(taskFieldValue);
      console.log(task[taskField.getAttribute("data-field-name")]);


      if(taskField.classList.contains("mark-as-todo-btn")) {
        if(task.status == "done" && task.type == "recurring") {
          taskField.style.display = "inline";
        } else {
          taskField.style.display = "none";
        }

        return;
      }

      if (taskField.classList.contains("mark-as-done-btn")) {
        // if task is not done then make the mark as done button visible
        const duePeriodElement = taskCard.querySelector(".due-period-visible");

        if (task.status != "done") {
          // find element with class 'due-period-visible' within the card and make it visible
          if(task.due_date) {
            duePeriodElement.innerHTML = dateTostring(task.due_date) + '<i class="bi bi-clock-history"></i>';

            // if task.due_date is in the past
            if(duePeriodElement.innerHTML.includes("ago")) {
              duePeriodElement.classList.add("late");
            } else {
              duePeriodElement.classList.remove("late");
            }
          }

          taskField.style.display = "inline";
        } else {
          duePeriodElement.innerHTML = "";

          taskField.style.display = "none";
        }

        return;
      }

      //  the due date indicator - should be set to the string value with teh actual hidden value updated.
      if(taskField.classList.contains("task-due-date-value")) {
        if(task.due_date) {
          taskField.value = task.due_date.split("T")[0];
        } else {
          taskField.value = "";
        }
        return;
      }

      if(taskField.classList.contains("task-due-date-value-actual")) {
        taskField.textContent = task[taskField.getAttribute("data-field-name")];
        return;
      }

      // handle modified and modified ts fields
      if(taskField.classList.contains("task-modified-date-value")) {
        taskField.textContent = dateTostring(task[taskField.getAttribute("data-field-name")]);
        return;
      }

      if(taskField.classList.contains("task-modified-date-value-actual")) {
        taskField.textContent = task[taskField.getAttribute("data-field-name")];
        return;
      }
      //  rooms
      if(taskField.classList.contains("task-rooms-value")) {
        taskField.textContent = Object.entries(task[taskField.getAttribute("data-field-name")]).map(([id, name]) => `${name} (ID: ${id})`).join(", ");
        return;
      }

      // due date indicator
      if(taskField.classList.contains("due-period-visible")) {
        taskField.innerHTML = dateTostring(task[taskField.getAttribute("data-field-name")]) + '<i class="bi bi-clock-history"></i>';

        // if taskfield innerhtml contains "ago" then the date is in the past
        if( taskField.innerHTML.includes("ago") ) {
          taskField.classList.add("late");
        }
        return;
      }

      // task dropdowns
      if(taskField.classList.contains("task-field-dropdown")) {
        taskField.value = task[taskField.getAttribute("data-field-name")];
        return;
      }

      //* do nothing for the expand button
      if(taskField.classList.contains("expand-task-card-button")) {
        return;
      }

      //* do nothing for the clear due date button
      if(taskField.classList.contains("btn-clear-task-deadline")) {
        return;
      }

      //* do nothing for the task delete button
      if(taskField.classList.contains("delete-task-button")) {
        return;
      }

      // set field value:
      taskField.textContent = task[taskField.getAttribute("data-field-name")];
    });

    const taskCardElement = taskCard.querySelector(".card");
    flashCard(taskCardElement, 2);
  });
}



// make the background of the card flash
function flashCard(taskCardElement, flashCount){
  // use animation param, use 'loading' keyframe
  taskCardElement.style.animation = `loading 1s linear ${flashCount}`;
  // after animation ends remove animation from style so it can be executed again:
  setTimeout(() => {
    taskCardElement.style.animation = "";
  }, 1000);
}



async function fetchLatestTimestamp() {
  let floorId = getFloorID();
  let roomId = getRoomID();
  let search = getSearch();

  let url = new URL(
    `/task/fetch_latest_task_timestamp`,
    window.location.origin
  );

  if (floorId) {
    url.searchParams.append("floor_id", floorId);
  }

  if (roomId) {
    url.searchParams.append("room_id", roomId);
  }

  if (search) {
    console.log("polling search")
    url.searchParams.append("search", search);
  }

  try {
    let response = await fetch(url);
    if (!response.ok) {
      throw new Error("Network response was not ok");
    }
    let data = await response.json();

    return data.latest_timestamp;
  } catch (error) {
    console.error("Failed to fetch the latest timestamp:", error);
    return null;
  }
}



/**
 ** Check whether the tasks on the page need to be updated.
 */
async function checkForUpdates() {
  let newTimestamp = await fetchLatestTimestamp();
  // console.log("new timestamp: ", newTimestamp);
  // console.log("latest timestamp: ", latestTimestamp);

  if (newTimestamp && newTimestamp !== latestTimestamp) {
    latestTimestamp = newTimestamp;

    updateTaskList();
    return;
  }

}
// Periodic check for updates
setInterval(checkForUpdates, updateIntervalSeconds * 1000);



//********************************************************** */
/**
 ** This Function makes it so each tasks field is editable and
 ** when a user edits a field it sends an update to the server.
 */
function initialize_fields() {
  initialize_mark_as_done_buttons();
  initialize_mark_as_to_do_buttons();
  initialize_expand_buttons();
  initialize_editable_spans();
  initialize_task_dropdowns();
  initialize_datepickers();
  initialize_clear_due_date_buttons();
  initialize_remove_room_buttons();
  initialize_task_remove_buttons();
  initialize_add_room_buttons();
}


function initialize_mark_as_done_buttons() {
  // Mark as done buttons.
  var markAsDoneBtns = document.querySelectorAll(".mark-as-done-btn");

  markAsDoneBtns.forEach(function(markAsDoneBtn) {
    console.log("Mark as done button found");

    //skip if an on click event is already attached

    if(markAsDoneBtn.getAttribute("has-event-listener") == "true") {
      return;
    }
    markAsDoneBtn.setAttribute("has-event-listener", "true");

    markAsDoneBtn.addEventListener("click", async function() {
      markAsDoneBtn.classList.add("active");

      setTimeout(function () {
        markAsDoneBtn.classList.remove("active");
      }, 200);

      console.log("Mark as done button clicked");
      var taskId = this.getAttribute("data-task-id");
      var fieldName = this.getAttribute("data-field-name");
      var value = this.getAttribute("data-value");
      var csrf = this.getAttribute("csrf");

      var cardHolder = this.parentElement.parentElement;
      var completedTasksHolder = document.getElementById("done_tasks_holder");
      var cardHolder = document.getElementById("task-" + taskId);
      var taskTypeValue = cardHolder.querySelector(".task-type-value").value;

      if(taskTypeValue !== "recurring" && !confirm("Are you sure you want to mark this task as done?")) {
        return;
      }

      console.log("taskTypeValue: ", taskTypeValue);
      console.log("Marking task as done");
      console.log(taskId);
      console.log(fieldName);
      console.log(value);

      update_task(taskId, fieldName, value, csrf);
      await new Promise(r => setTimeout(r, 200));

      // append to first element in the completed tasks holder
      completedTasksHolder.insertBefore(cardHolder, completedTasksHolder.firstElementChild);
    });
  });
}



function initialize_mark_as_to_do_buttons() {
  // Mark as to_do buttons.
  var markAsToDoBtns = document.querySelectorAll(".mark-as-todo-btn");

  markAsToDoBtns.forEach(function(markAsToDoBtn) {
    if(markAsToDoBtn.getAttribute("has-event-listener") == "true") {
      return;
    }
    markAsToDoBtn.setAttribute("has-event-listener", "true");

    markAsToDoBtn.addEventListener("click", async function() {
      markAsToDoBtn.classList.add("active");

      setTimeout(function () {
        markAsToDoBtn.classList.remove("active");
      }, 200);

      var taskId = this.getAttribute("data-task-id");
      var fieldName = this.getAttribute("data-field-name");
      var value = this.getAttribute("data-value");
      var csrf = this.getAttribute("csrf");
      console.log("Marking task as to_do");
      console.log(taskId);
      console.log(fieldName);
      console.log(value);
      update_task(taskId, fieldName, value, csrf);

      // make the entire card slowly fade out
      var cardHolder = this.parentElement.parentElement;

      // move card element to the top of the pending  tasks holder
      var pendingTasksHolder = document.getElementById("pending_tasks_holder");
      var cardHolder = document.getElementById("task-" + taskId);

      // delay by 200ms to allow the animation to complete
      await new Promise(r => setTimeout(r, 200));

      // append to first element in the pending tasks holder
      pendingTasksHolder.insertBefore(cardHolder, pendingTasksHolder.firstElementChild);
    });
  });
}



function initialize_expand_buttons(){
  // Expand task card button.
  const expandTaskCardButton = document.querySelectorAll(".expand-task-card-button");
  expandTaskCardButton.forEach(function(expandTaskCardButton) {
    if(expandTaskCardButton.getAttribute("has-event-listener") == "true") {
      return;
    }

    expandTaskCardButton.setAttribute("has-event-listener", "true");

    expandTaskCardButton.addEventListener("click", function() {

      const arrowUpIcon = '<i class="bi bi-arrow-bar-up expand-task-card-button-icon"></i>';
      const arrowDownIcon = '<i class="bi bi-arrow-bar-down expand-task-card-button-icon"></i>';
      const taskId = this.getAttribute("data-task-id");
      const taskCardHolder = document.getElementById("task-" + taskId);
      const hideableElements = taskCardHolder.querySelectorAll(".hideable");

      if(this.innerHTML === arrowDownIcon) {
        console.log("display elements");
        this.innerHTML = arrowUpIcon;
        hideableElements.forEach(function(hideableElement) {
          hideableElement.classList.add("show");
        });
      } else {
        console.log("hide elements");
        this.innerHTML = arrowDownIcon;
        hideableElements.forEach(function(hideableElement) {
          hideableElement.classList.remove("show");
        });
      }
    });
  });
}


function initialize_editable_spans(){
  //* Handle editable spans.
  function handleFocus(event) {
    event.target.dataset.oldValue = event.target.textContent;
  }

  async function handleEdit(event) {
    if (event.type === "keypress" && event.key !== "Enter") {
      return;
    } else if (event.type === "keypress") {
      event.preventDefault();
      event.target.blur();
    }
    const oldValue = event.target.dataset.oldValue;
    const newValue = event.target.textContent;

    // Debug print
    // console.log(`Old Value: ${oldValue}, New Value: ${newValue}`);
    if (oldValue == newValue) {
      // No changes made.
      return;
    }

    // Update the task.
    spanElement = event.target;
    console.log(spanElement);

    task_id = spanElement.getAttribute("data-task-id");
    field_name = spanElement.getAttribute("data-field-name");
    csrf = spanElement.getAttribute("csrf");

    console.log(task_id);
    console.log(field_name);
    console.log(newValue);

    const response = await update_task(task_id, field_name, newValue, csrf);
    const response_json = await response.json;
  }

  // Add event listeners to each editable span
  const editableSpans = document.querySelectorAll(
    'span[contenteditable="true"]'
  );


  editableSpans.forEach((span) => {
    if(span.getAttribute("has-event-listener") == "true") {
      return;
    }

    span.setAttribute("has-event-listener", "true");
    span.addEventListener("focus", handleFocus);
    span.addEventListener("blur", handleEdit);
    span.addEventListener("keypress", handleEdit);
  });
}


function initialize_task_dropdowns(){
  // Add event listeners to each dropdown
  async function handleDropdownChange(event) {
    const dropdown = event.target;
    const task_id = dropdown.getAttribute("data-task-id");
    const field_name = dropdown.getAttribute("data-field-name");
    const csrf = dropdown.getAttribute("csrf");

    const response = await update_task(task_id, field_name, dropdown.value, csrf);
    const response_json = await response.json;
  }

  const dropdowns = document.querySelectorAll(".task-field-dropdown");
  dropdowns.forEach((dropdown) => {
    if(dropdown.getAttribute("has-event-listener") == "true") {
      return;
    }

    dropdown.setAttribute("has-event-listener", "true");
    dropdown.addEventListener("change", handleDropdownChange);
  });
}

function initialize_datepickers(){
   // Add event listeners to each datepicker
   async function handleDatepickerChange(event) {
    const datepicker = event.target;
    const task_id = datepicker.getAttribute("data-task-id");
    const field_name = datepicker.getAttribute("data-field-name");
    const csrf = datepicker.getAttribute("csrf");

    const response = await update_task(task_id, field_name, datepicker.value, csrf);
    const response_json = await response.json;
  }

  const datepickers = document.querySelectorAll(".task-field-datepicker");
  datepickers.forEach((datepicker) => {
    if(datepicker.getAttribute("has-event-listener") == "true") {
      return;
    }

    datepicker.setAttribute("has-event-listener", "true");
    datepicker.addEventListener("change", handleDatepickerChange);
  });
}


function initialize_clear_due_date_buttons(){
  const clear_due_date_button = document.querySelectorAll(".btn-clear-task-deadline");

  clear_due_date_button.forEach((clear_due_date_button) => {
    if(clear_due_date_button.getAttribute("has-event-listener") == "true") {
      return;
    }

    clear_due_date_button.setAttribute("has-event-listener", "true");
    clear_due_date_button.addEventListener("click", function() {
      console.log("Clear due date button clicked");
      // clear due date text field value
      const dueDatePicker = clear_due_date_button.parentElement.querySelector(".task-due-date-value");
      dueDatePicker.value = "";

      // Send update to server
      const task_id = this.getAttribute("data-task-id");
      const field_name = this.getAttribute("data-field-name");
      const csrf = this.getAttribute("csrf");

      console.log(task_id);
      console.log(field_name);
      console.log(csrf);

      update_task(task_id, field_name, null, csrf);
    });
  });
}

function initialize_remove_room_buttons(){
  const remove_room_button = document.querySelectorAll(".room-delete-button");

  remove_room_button.forEach((remove_room_button) => {
    if(remove_room_button.getAttribute("has-event-listener") == "true") {
      return;
    }

    remove_room_button.setAttribute("has-event-listener", "true");
    remove_room_button.addEventListener("click", function() {
      console.log("Remove room button clicked");

      const task_id = this.getAttribute("data-task-id");
      const field_name = this.getAttribute("data-field-name");
      const room_id = this.getAttribute("data-room-id");
      const csrf = this.getAttribute("csrf");

      console.log("task id ",task_id);
      console.log("field name ",field_name);
      console.log("room id ",room_id);
      console.log("csrf ",csrf);

      if(confirm("Are you sure you want to remove this room from the task?")) {
        console.log("Removing room");
        update_task(task_id, field_name, room_id, csrf);
        latestTimestamp = null;
      } else {
        console.log("Not removing room");
      }
    });
  });
}

function initialize_task_remove_buttons(){
  const remove_task_button = document.querySelectorAll(".delete-task-button");

  remove_task_button.forEach((remove_task_button) => {
    if(remove_task_button.getAttribute("has-event-listener") == "true") {
      return;
    }

    remove_task_button.setAttribute("has-event-listener", "true");
    remove_task_button.addEventListener("click", function() {
      console.log("Remove task button clicked");

      const task_id = this.getAttribute("data-task-id");
      const csrf = this.getAttribute("csrf");

      console.log("task id ",task_id);
      console.log("csrf ",csrf);

      if(confirm("Are you sure you want to remove this task?")) {
        console.log("Removing task ", task_id);
        delete_task(task_id, csrf);
      } else {
        console.log("Not removing task");
      }
    });
  });
}


function initialize_add_room_buttons(){
  const addRoomButton = document.querySelectorAll(".show-room-modal-btn");

  // open modal and load data into it.
  addRoomButton.forEach((addRoomButton) => {
    if(addRoomButton.getAttribute("has-event-listener") == "true") {
      return;
    }
    addRoomButton.setAttribute("has-event-listener", "true");

    addRoomButton.addEventListener("click", function() {
      console.log("Add room button clicked");

      const task_id = this.getAttribute("data-task-id");
      var task = global_pending_tasks.find((task) => task.id == task_id);

      // fetch the modal which has id "add-room-modal"
      var addRoomModal = document.getElementById("add-room-modal");

      // set data-task-id attribute of the modal to the task id
      addRoomModal.setAttribute("data-task-id", task_id);

      if(!task) {
        console.log("Task not found in pending tasks");
        task = global_done_tasks.find((task) => task.id == task_id);
      }

      var roomModalRooms = document.querySelectorAll(".room-label-modal");

      // loop once to reset state of the modal.
      roomModalRooms.forEach((roomModalRoom) => {
        roomModalRoom.classList.remove("add-room-locked");
        var roomIconElement = roomModalRoom.querySelector(".room-icon-label");
        roomIconElement.classList.remove("bi-check2-circle");
        roomIconElement.classList.remove("hidden");
        roomIconElement.classList.add("bi-circle");
      });

      roomModalRooms.forEach((roomModalRoom) => {
        var room_id = roomModalRoom.getAttribute("data-room-id");
        var roomIconElement = roomModalRoom.querySelector(".room-icon-label");
        roomIconElement.setAttribute("data-task-id", task_id);

        if(!task.rooms[room_id]) {
          roomIconElement.classList.remove("bi-check2-circle");
          roomIconElement.classList.add("bi-circle");
          return;
        }

        roomIconElement.classList.remove("bi-circle");
        roomIconElement.classList.add("hidden");

        // add add-room-locked class to parent element
        roomModalRoom.classList.add("add-room-locked");
      });
    });
  });

  // Handle the click of a checkbox in the room add modal
  const checkboxButtons = document.querySelectorAll(".room-icon-label");
  checkboxButtons.forEach((checkboxButton) => {
    if(checkboxButton.getAttribute("has-event-listener") == "true") {
      return;
    }
    checkboxButton.setAttribute("has-event-listener", "true");


    checkboxButton.addEventListener("click", function() {
      const task_id = checkboxButton.getAttribute("data-task-id");
      // get task with  task_id from global_pending_tasks or global_done_tasks
      var task = global_pending_tasks.find((task) => task.id == task_id);

      if(!task) {
        task = global_done_tasks.find((task) => task.id == task_id);
      }

      // Check whether the room is already in the task
      if(task.rooms[this.getAttribute("data-room-id")]) {
        // Task is already assigned to the room.
        return;
      }

      console.log("Checkbox button clicked");
      if(this.classList.contains("bi-check2-circle")) {
        this.classList.remove("bi-check2-circle");
        this.classList.add("bi-circle");
        return;
      }

      this.classList.remove("bi-circle");
      this.classList.add("bi-check2-circle");
    });
  });

  const saveRoomSelectionButton = document.getElementById('save-room-selection-modal');

  if(saveRoomSelectionButton.getAttribute("has-event-listener") == "true") {
    return;
  }

  saveRoomSelectionButton.setAttribute("has-event-listener", "true");

  saveRoomSelectionButton.addEventListener("click", function() {
    console.log("Save room selection button clicked");
    const modal = document.getElementById("add-room-modal");
    const task_id = modal.getAttribute("data-task-id");
    const roomIconLabels = document.querySelectorAll(".room-icon-label");

    // remove all room icon labels
    var rooms_to_add = []
    roomIconLabels.forEach((roomIconLabel) => {
      // if room icon label has class bi-circle return
      const roomId = roomIconLabel.parentElement.getAttribute("data-room-id");
      if(!roomIconLabel.classList.contains("bi-check2-circle")) {
        return;
      }

      // get parent element, get data-room-id attribute from it

      if(!roomId){
        return;
      }

      console.log("room id ",roomId);
      rooms_to_add.push(roomId);
    });

    if(rooms_to_add.length != 0) {
      var csrf = saveRoomSelectionButton.getAttribute("csrf");
      update_task(task_id, 'room_add', rooms_to_add, csrf);
    }

    // click close button with ID close-room-modal
    const closeRoomModalButton = document.getElementById("close-room-modal");
    closeRoomModalButton.click();

  });
}


function update_task(task_id, field_name, value, csrf) {
  //cast task_id to integer
  var post_data = {
    task_id: task_id,
    field_name: field_name,
    value: value,
  };

  console.log(post_data);
  console.log(csrf);

  return fetch("/task/update_task/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": csrf,
      },
      body: JSON.stringify(post_data),
    })
    .then((response) => response.json())
    .then((data) => {
      return data;
    })
    .catch((error) => {
      console.error("Error:", error);
      return {
        status: "error"
      };
    });
}

function delete_task(task_id, csrf) {
  var delete_data = {
    task_id: task_id,
  };

  console.log(delete_data);
  return fetch("/task/delete_task/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": csrf,
    },
    body: JSON.stringify(delete_data),
  })
    .then((response) => response.json())
    .then((data) => {
      return data;
    })
    .catch((error) => {
      console.error("Error:", error);
      return {
        status: "error",
      };
    });
}

function loadElements() {
  loadPendingTasks();
  loadDoneTasks();
}

async function loadPendingTasks() {
  const pending_tasks = await fetchTasks(false);

  // fade out elements with class lading-container-pending
  const loading_containers = document.querySelectorAll(
    ".lading-container-pending"
  );

  loading_containers.forEach((container) => {
     container.classList.add("fade");
    // also set display to none
    container.style.display = "none";
  });

  // show congrats banner if no tasks
  if (pending_tasks.length === 0) {
    document.getElementById("no-tasks-congrats").style.display = "block";
  }

  renderTasks(pending_tasks, "pending_tasks_holder");
}

async function loadDoneTasks() {
  const done_tasks = await fetchTasks(true);

  if(done_tasks.length === 0) {
    console.log(tasks);
    document.getElementById("no_tasks_completed").style.display = "block";
  }

  renderTasks(done_tasks, "done_tasks_holder");
}

function renderTasks(tasks, elementId) {
  const container = document.getElementById(elementId);
  const template = document.getElementById("task-template");
  const fragment = document.createDocumentFragment();


  tasks.forEach((task) => {
    if(task.deleted_date) {
      return;
    }

    const taskCard = template.content.cloneNode(true);

    // set id attribute of the element with class task-holder to be "task-" + task.id
    taskCard.querySelector(".task-holder").id = "task-" + task.id;

    // task data
    taskCard.querySelector(".task-name").textContent = task.task_name;
    taskCard.querySelector(".task-description").textContent = task.task_description;
    taskCard.querySelector(".task-status-value").textContent = task.status;

    // task dropdowns
    taskCard.querySelector(".task-type-value").value = task.type;
    taskCard.querySelector(".task-category-value").value = task.category;

    // dates

    //* Due date
    // from this format 2024-05-29T00:00:00+00:00
    // cut off only this part 2024-05-29
    taskCard.querySelector(".task-due-date-value").value = task.due_date ? task.due_date.split("T")[0] : null;

    taskCard.querySelector(".task-due-date-value-actual").textContent = task.due_date;
    taskCard.querySelector(".task-creation-date-value").textContent = dateTostring(task.creation_date);
    taskCard.querySelector(".task-modified-date-value-actual").textContent = task.modified_date;
    taskCard.querySelector(".task-modified-date-value").textContent = task.modified_date ? dateTostring(task.modified_date) : null;
    taskCard.querySelector(".task-completed-date-value").textContent = task.completed_date ? dateTostring(task.completed_date) : null;

    taskCard.querySelector(".show-room-modal-btn").setAttribute("data-task-id", task.id);
    //* rooms
    taskCard.querySelector(".task-rooms-value").textContent = Object.entries( task.rooms ).map(([id, name]) => `${name} (ID: ${id})`).join(", ");

    if (task.status == "done") {
      // hide "mark as done" button
      taskCard.querySelector(".mark-as-done-btn").style.display = "none";

      // make completed-task-icon visible
      taskCard.querySelector(".completed-task-icon").style.display = "inline";

      // hide "mark as to_do" button
      if(task.type == "single") {
        taskCard.querySelector(".mark-as-todo-btn").style.display = "none";
      }
    } else {
      // if task is not done, hide completed date, and redo button
      taskCard.querySelector(".mark-as-todo-btn").style.display = "none";
      taskCard.querySelector(".task-completed-date-label").style.display = "none";
      taskCard.querySelector(".task-completed-date-value").style.display = "none";
      taskCard.querySelector(".due-period-visible").innerHTML = task.due_date ? dateTostring(task.due_date) + ' <i class="bi bi-clock-history"></i>' : "";

      if(taskCard.querySelector(".due-period-visible").innerHTML.includes("ago")) {
        taskCard.querySelector(".due-period-visible").classList.add("late");
      }

      if(task.type == "recurring") {
        taskCard.querySelector(".repeatable-task-icon").style.display = "inline";
      }
    }

    //* Display specific elements for special tasks
    if(task.category == "urgent" && task.status !== "done") {
      var shadowClassElement = taskCard.querySelector(".shadow");
      shadowClassElement.classList.remove("shadow");
      shadowClassElement.classList.add("urgent-task");
      taskCard.querySelector(".task-category-visual").innerHTML = "Urgent";
      taskCard.querySelector(".task-category-visual").classList.add("urgent-task-visual");
    }

    //* Display specific elements for urgent tasks
    if(task.category == "special" && task.status !== "done") {
      var shadowClassElement = taskCard.querySelector(".shadow");
      shadowClassElement.classList.remove("shadow");
      shadowClassElement.classList.add("special-task");
      taskCard.querySelector(".task-category-visual").innerHTML = "Special";
      taskCard.querySelector(".task-category-visual").classList.add("special-task-visual");
    }

    if(task.category == "normal" || task.status == "done") {
      // find card-body element and add padding-top of 10px;
      var cardBodyElement = taskCard.querySelector(".card-body");
      cardBodyElement.style.paddingTop = "10px";

    }

    //* Set the data task id value in each task field.
    const taskFields = taskCard.querySelectorAll(".task-field");

    taskFields.forEach((taskField) => {
      taskField.setAttribute("data-task-id", task.id);
    });

    //* check it modified date is newer than the latest timestamp and update the latest timestamp
    if (!latestTimestamp || task.modified_date > latestTimestamp) {
      latestTimestamp = task.modified_date;
    }

    renderRooms(taskCard, task);

    fragment.appendChild(taskCard);
  });

  container.appendChild(fragment);

  fieldsLoaded++;

  if (fieldsLoaded == 2) {
    initialize_fields();
  }
}


//* Rooms
//* For each room generate a room remover element
function renderRooms(taskCard, task) {
  const roomDeleteHolder = taskCard.querySelector(".room-delete-holder");

  var roomsFragment = document.createDocumentFragment();
  for (var [room_id, room] of Object.entries(task.rooms)) {
    var roomTemplate = document.getElementById("room-remover-template");
    var roomRemover = roomTemplate.content.cloneNode(true);

    var iconLabel = roomRemover.querySelector(".room-icon-label");
    iconLabel.textContent = room.icon;

    var roomLabel = roomRemover.querySelector(".room-name-label");
    roomLabel.textContent = room.name;

    var roomDeleteButton = roomRemover.querySelector(".room-delete-button");
    roomDeleteButton.setAttribute("data-task-id", task.id);
    roomDeleteButton.setAttribute("data-room-id", room_id);

    roomDeleteHolder.appendChild(roomRemover);
  }

  taskCard.querySelector(".room-delete-holder").appendChild(roomsFragment);
}


/* Helper */
function dateTostring(date) {
  const now = new Date();
  const targetDate = new Date(date);

  const diff = targetDate - now;
  const absDiff = Math.abs(diff);

  const minutes = Math.floor(absDiff / (1000 * 60));
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30); // Approximate months
  const years = Math.floor(days / 365); // Approximate years


  if (diff > 0) {
    if (years > 0) {
      return `${years} year${years > 1 ? "s" : ""}`;
    } else if (months > 0) {
      return `${months} month${months > 1 ? "s" : ""}`;
    } else if (days > 0) {
      return `${days} day${days > 1 ? "s" : ""}`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? "s" : ""}`;
    } else {
      if(minutes === 0) {
        return "now";
      } else {
        return `${minutes} minute${minutes > 1 ? "s" : ""}`;
      }
    }
  } else {
    if (years > 0) {
      return `${years} year${years > 1 ? "s" : ""} ago`;
    } else if (months > 0) {
      return `${months} month${months > 1 ? "s" : ""} ago`;
    } else if (days > 0) {
      return `${days} day${days > 1 ? "s" : ""} ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    } else {
      if(minutes === 0) {
        return "now";
      } else {
        return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
      }
    }
  }
}

/* Helper */
function getRoomID() {
  var room_id_holder = document.getElementById("room_id_holder");
  var room_id = null;

  if (room_id_holder) {
    room_id = room_id_holder.getAttribute("room_id");
  }

  return room_id;
}

/* Helper */
function getFloorID() {
  var floor_id_holder = document.getElementById("floor_id_holder");
  var floor_id = null;

  if (floor_id_holder) {
    floor_id = floor_id_holder.getAttribute("floor_id");
  }

  return floor_id;
}

function getSearch() {
  var search_holder = document.getElementById("search_holder");
  var search = null;

  if (search_holder) {
    search = search_holder.getAttribute("search");
  }

  return search;
}

/* Helper */
function fetchTasks(completed = false) {
  let floor_id = getFloorID();
  let room_id = getRoomID();
  let search = getSearch();

  let url = new URL(`/task/fetch_tasks`, window.location.origin);

  if (floor_id) {
    url.searchParams.append("floor_id", floor_id);
  }

  if (room_id) {
    url.searchParams.append("room_id", room_id);
  }

  if (search) {
    console.log("fetching search");
    url.searchParams.append("search", search);
  }

  url.searchParams.append("completed", completed);

  // Return the fetch promise
  return fetch(url)
    .then((response) => {
      if (!response.ok) {
        throw new Error("Network response was not ok");
      }
      return response.json();
    })
    .then((tasks) => {
      if(completed) {
        global_done_tasks = tasks;
      } else {
        global_pending_tasks = tasks;
      }
      return tasks;
    })
    .catch((error) => {
      console.error("Failed to fetch tasks:", error);
      return [];
    });
}
