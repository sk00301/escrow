const express = require("express");
const app = express();

app.use(express.json());

/**
 * In-memory storage
 */
let tasks = [];
let currentId = 1;

/**
 * Helper: Find task by ID
 */
function findTask(id) {
  return tasks.find(t => t.id === id);
}

/**
 * CREATE TASK
 */
app.post("/tasks", (req, res) => {
  const { title } = req.body;

  if (!title || title.trim() === "") {
    return res.status(400).json({ error: "Title is required" });
  }

  const newTask = {
    id: currentId++,
    title: title.trim(),
    completed: false,
  };

  tasks.push(newTask);
  res.status(201).json(newTask);
});

/**
 * GET ALL TASKS
 */
app.get("/tasks", (req, res) => {
  res.json(tasks);
});

/**
 * GET SINGLE TASK
 */
app.get("/tasks/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const task = findTask(id);

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  res.json(task);
});

/**
 * UPDATE TASK (MARK COMPLETE / EDIT TITLE)
 */
app.put("/tasks/:id", (req, res) => {
  const id = parseInt(req.params.id);
  const task = findTask(id);

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  const { title, completed } = req.body;

  if (title !== undefined) {
    if (title.trim() === "") {
      return res.status(400).json({ error: "Title cannot be empty" });
    }
    task.title = title.trim();
  }

  if (completed !== undefined) {
    task.completed = Boolean(completed);
  }

  res.json(task);
});

/**
 * DELETE TASK
 */
app.delete("/tasks/:id", (req, res) => {
  const id = parseInt(req.params.id);

  const index = tasks.findIndex(t => t.id === id);

  if (index === -1) {
    return res.status(404).json({ error: "Task not found" });
  }

  const deletedTask = tasks.splice(index, 1);

  res.json({
    message: "Task deleted",
    task: deletedTask[0],
  });
});

/**
 * CLEAR ALL TASKS (bonus endpoint)
 */
app.delete("/tasks", (req, res) => {
  tasks = [];
  currentId = 1;

  res.json({ message: "All tasks cleared" });
});

/**
 * START SERVER
 */
const PORT = 3000;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
