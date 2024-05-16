var fieldsLoaded = 0;
  var noChangesCounter = 0;
  var updateIntervalSeconds = 10;
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

    allTasks = pending_tasks.concat(done_tasks);
    updateTasksOnPage(allTasks);
    //addMissingTasks(allTasks);
  }

  function updateTasksOnPage(tasks) {
    /*
     * Update the task fields in the dom for all tasks given a list of tasks from the server..
     */

    tasks.forEach((task) => {
      const taskCard = document.getElementById(`task-${task.id}`);

      if (!taskCard) {
        console.log("Task card not found");
        return;
      }

      // check if the last modified date is different from the one in the task card
      const pageTaskModifiedDate = taskCard.querySelector(
        ".task-modified-date-value-actual"
      ).textContent;

      console.log("pageTaskModifiedDate: " + pageTaskModifiedDate);
      console.log("task.modified_date: " + task.modified_date);

      if (pageTaskModifiedDate == task.modified_date) {
        console.log("task " + task.id + " has not been modified continuing");
        return;
      }

      console.log("task " + task.id + " has been modified - updating");

      const taskFields = taskCard.querySelectorAll(".task-field");
      taskFields.forEach((taskField) => {
        const taskFieldValue = taskField.textContent;

        console.log("UPDATING TASK FIELD + " + taskField.getAttribute("data-field-name"));
        console.log(taskFieldValue);
        console.log(task[taskField.getAttribute("data-field-name")]);

        //* skip following fields, they will be handled differently -
        //* the
        //  taskdone button,
        // - if the element has class mark-as-done-btn then dont update the value

        //- testing
        if(taskField.classList.contains("mark-as-done-btn") && task.status == "done"){
          taskField.classList.add("hide");
          return;
        }

        if(taskField.classList.contains("mark-as-todo-btn") && task.status !== "done"){
          taskField.classList.add("hide");
          return;
        }

        //  the due date indicator - should be set to the string value with teh actual hidden value updated.
        //  rooms  - skip for now

        // set field value:
        taskField.textContent = task[taskField.getAttribute("data-field-name")];
      });
    });
  }

  async function fetchLatestTimestamp() {
    let floorId = getFloorID();
    let roomId = getRoomID();
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
    // Mark as done buttons.
    var markAsDoneBtns = document.querySelectorAll(".mark-as-done-btn");

    markAsDoneBtns.forEach(function(markAsDoneBtn) {
      console.log("Mark as done button found");
      markAsDoneBtn.addEventListener("click", function() {
        console.log("Mark as done button clicked");
        var taskId = this.getAttribute("data-task-id");
        var fieldName = this.getAttribute("data-field-name");
        var value = this.getAttribute("data-value");
        var csrf = this.getAttribute("csrf");
        console.log("Marking task as done");
        console.log(taskId);
        console.log(fieldName);
        console.log(value);
        update_task(taskId, fieldName, value, csrf);
      });
    });

    // Mark as to_do buttons.
    var markAsToDoBtns = document.querySelectorAll(".mark-as-todo-btn");

    markAsToDoBtns.forEach(function(markAsToDoBtn) {
      console.log("Mark as to_do button found");
      markAsToDoBtn.addEventListener("click", function() {
        console.log("Mark as to_do button clicked");
        var taskId = this.getAttribute("data-task-id");
        var fieldName = this.getAttribute("data-field-name");
        var value = this.getAttribute("data-value");
        var csrf = this.getAttribute("csrf");
        console.log("Marking task as to_do");
        console.log(taskId);
        console.log(fieldName);
        console.log(value);
        update_task(taskId, fieldName, value, csrf);
      });
    });

    const editableSpans = document.querySelectorAll(
      'span[contenteditable="true"]'
    );

    // Editable spans.
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

      if (oldValue == newValue) {
        console.log(`Old Value: ${oldValue}, New Value: ${newValue}`);
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
      console.log("result:");
      console.log(response_json);
      /*if(result.status == "error") {
            console.log("Error updating task");
            console.log(result);
            spanElement.textContent = oldValue;
        }*/
    }

    // Add event listeners to each span
    editableSpans.forEach((span) => {
      span.addEventListener("focus", handleFocus);
      span.addEventListener("blur", handleEdit);
      span.addEventListener("keypress", handleEdit);
    });
  }

  function update_task(task_id, field_name, value, csrf) {
    var post_data = {
      task_id: task_id,
      field_name: field_name,
      value: value,
    };

    console.log(post_data);

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
    renderTasks(pending_tasks, "pending_tasks_holder");
  }

  async function loadDoneTasks() {
    const done_tasks = await fetchTasks(true);
    renderTasks(done_tasks, "done_tasks_holder");
  }

  function renderTasks(tasks, elementId) {
    const container = document.getElementById(elementId);
    const template = document.getElementById("task-template");
    const fragment = document.createDocumentFragment();

    tasks.forEach((task) => {
      const taskCard = template.content.cloneNode(true);

      // set id attribute of the element with class task-holder to be "task-" + task.id
      taskCard.querySelector(".task-holder").id = "task-" + task.id;

      // task data
      taskCard.querySelector(".task-name").textContent = task.task_name;
      taskCard.querySelector(".task-description").textContent = task.task_description;
      taskCard.querySelector(".task-status-value").textContent = task.status;
      taskCard.querySelector(".task-type-value").textContent = task.type;
      taskCard.querySelector(".task-category-value").textContent = task.category;

      // dates
      taskCard.querySelector(".task-due-date-value").textContent = task.due_date ? dateTostring(task.due_date) : null;
      taskCard.querySelector(".task-creation-date-value").textContent = dateTostring(task.creation_date);
      taskCard.querySelector(".task-modified-date-value-actual").textContent = task.modified_date;
      taskCard.querySelector(".task-modified-date-value").textContent = task.modified_date ? dateTostring(task.modified_date) : null;
      taskCard.querySelector(".task-completed-date-value").textContent = task.completed_date ? dateTostring(task.completed_date) : null;

      // rooms
      taskCard.querySelector(".task-rooms-value").textContent = Object.entries( task.rooms ).map(([id, name]) => `${name} (ID: ${id})`).join(", ");

      if (task.status == "done") {
        // hide "mark as done" button
        taskCard.querySelector(".mark-as-done-btn").style.display = "none";
      } else {
        // hide completed label and value from template
        taskCard.querySelector(".task-completed-date-label").style.display = "none";
        taskCard.querySelector(".task-completed-date-value").style.display = "none";
      }

      //* hide due date if value is not set or 'N/A'
      if (task.due_date == null || task.due_date == "N/A") {
        taskCard.querySelector(".task-due-date-label").style.display = "none";
        taskCard.querySelector(".task-due-date-value").style.display = "none";
      }

      //* Hide created/modified fields and labels entirely.
      // Comment these lines for debugging purposes:
      //taskCard.querySelector(".task-creation-date-label").style.display = "none";
      //taskCard.querySelector(".task-creation-date-value").style.display = "none";
      //taskCard.querySelector(".task-modified-date-label").style.display = "none";
      //taskCard.querySelector(".task-modified-date-value").style.display = "none";

      //* Set the data task id value in each task field.
      const taskFields = taskCard.querySelectorAll(".task-field");

      taskFields.forEach((taskField) => {
        taskField.setAttribute("data-task-id", task.id);
      });

      //* check it modified date is newer than the latest timestamp and update the latest timestamp
      if (!latestTimestamp || task.modified_date > latestTimestamp) {
        latestTimestamp = task.modified_date;
      }

      fragment.appendChild(taskCard);
    });

    container.appendChild(fragment);

    fieldsLoaded++;

    if (fieldsLoaded == 2) {
      initialize_fields();
    }
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
        return `In ${years} year${years > 1 ? "s" : ""}`;
      } else if (months > 0) {
        return `In ${months} month${months > 1 ? "s" : ""}`;
      } else if (days > 0) {
        return `In ${days} day${days > 1 ? "s" : ""}`;
      } else if (hours > 0) {
        return `In ${hours} hour${hours > 1 ? "s" : ""}`;
      } else {
        return `In ${minutes} minute${minutes > 1 ? "s" : ""}`;
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
        return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
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

  /* Helper */
  function fetchTasks(completed = false) {
    let floor_id = getFloorID();
    let room_id = getRoomID();
    let url = new URL(`/task/fetch_tasks`, window.location.origin);

    if (floor_id) {
      url.searchParams.append("floor_id", floor_id);
    }

    if (room_id) {
      url.searchParams.append("room_id", room_id);
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
        console.log("Tasks:", tasks);
        return tasks;
      })
      .catch((error) => {
        console.error("Failed to fetch tasks:", error);
        return [];
      });
  }
