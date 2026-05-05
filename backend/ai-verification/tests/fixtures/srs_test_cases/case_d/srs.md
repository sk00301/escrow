# Software Requirements Specification (SRS)
## Simple To-Do API

---

## 1. Introduction

### 1.1 Purpose
This document defines the requirements for a Simple To-Do API used to manage tasks in a small team or personal productivity setup. The API supports creating, reading, updating, and deleting tasks.

### 1.2 Scope
The system provides REST endpoints to:
- create tasks
- fetch all tasks
- fetch a single task
- update task title or completion status
- delete a task
- clear all tasks

The system stores data in memory only. No database, authentication, or frontend is included.

### 1.3 Intended Audience
- Developer implementing the API
- Tester validating the API
- Reviewer checking scope and behavior

### 1.4 Definitions
- **Task**: A to-do item with a title and completion status
- **Completed**: A boolean value indicating whether a task is finished
- **REST API**: HTTP-based service exposing resources through endpoints

---

## 2. Overall Description

### 2.1 Product Perspective
The product is a lightweight Node.js + Express backend. It is designed for demonstration, testing, and small internal use.

### 2.2 Product Functions
The system shall:
- accept task creation requests
- return task lists
- update task details
- delete individual tasks
- remove all tasks at once

### 2.3 User Classes
- **General API Client**: Any client making HTTP requests, such as Postman, browser tools, or another app

### 2.4 Operating Environment
- Node.js runtime
- Express.js framework
- HTTP client for testing
- No database required

### 2.5 Constraints
- Data is stored in memory only
- Data is lost on server restart
- Task IDs are generated sequentially
- Title is required for task creation

### 2.6 Assumptions
- Only one instance of the server is running
- Requests are sent as valid JSON unless otherwise stated
- There is no concurrent multi-user conflict handling beyond basic in-memory operations

---

## 3. Functional Requirements

### 3.1 Task Creation
The system shall allow a user to create a task by providing a title.

#### Rules
- Title must not be empty
- Title must not contain only whitespace
- Newly created task shall have:
  - a unique numeric ID
  - the provided title
  - completed set to false

#### Output
- Return the created task with HTTP status `201 Created`

---

### 3.2 Retrieve All Tasks
The system shall return all tasks currently stored in memory.

#### Rules
- If no tasks exist, return an empty array
- Tasks shall be returned in the order they were created

#### Output
- Return array of task objects with HTTP status `200 OK`

---

### 3.3 Retrieve Single Task
The system shall return one task by its ID.

#### Rules
- The ID must be numeric
- If task is not found, return a `404 Not Found`

#### Output
- Return the task object with HTTP status `200 OK`

---

### 3.4 Update Task
The system shall allow updating task title and/or completion status.

#### Rules
- User may update:
  - `title`
  - `completed`
- If title is provided:
  - it must not be empty
  - it must be trimmed
- If completed is provided:
  - it shall be converted to boolean
- Fields not provided shall remain unchanged

#### Output
- Return the updated task with HTTP status `200 OK`

---

### 3.5 Delete Task
The system shall delete a task by its ID.

#### Rules
- If task does not exist, return `404 Not Found`
- Deleted task should be removed from memory permanently until server restart or recreation

#### Output
- Return confirmation message and deleted task data

---

### 3.6 Clear All Tasks
The system shall remove all tasks from memory.

#### Rules
- All stored tasks shall be deleted
- Task ID counter shall be reset to 1

#### Output
- Return confirmation message with HTTP status `200 OK`

---

## 4. Detailed Function Specifications

### 4.1 `findTask(id)`
**Purpose:** Find a task in memory by numeric ID.

**Input:**
- `id` (number)

**Output:**
- Task object if found
- `undefined` if not found

**Behavior:**
- Search through the task array
- Return the first task whose ID matches

**Preconditions:**
- Tasks array exists

**Postconditions:**
- No modification to tasks array

---

### 4.2 `POST /tasks`
**Purpose:** Create a new task.

**Request Body:**
```json
{
  "title": "Buy milk"
}