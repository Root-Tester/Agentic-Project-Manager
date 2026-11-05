// Web UI Application Logic - Upgraded SaaS Version
document.addEventListener('DOMContentLoaded', () => {
  // HTML escaping utility for XSS security
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Task & Employee state
  let tasksData = [];
  let employeesList = [];

  // DOM Elements
  const milestoneInput = document.getElementById('milestone-input');
  const employeesInput = document.getElementById('employees-input');
  const generateBtn = document.getElementById('generate-btn');
  const saveBtn = document.getElementById('save-btn');
  const configBtn = document.getElementById('config-btn');
  const loader = document.getElementById('loader');
  const placeholderText = document.getElementById('placeholder-text');

  // Stats Elements
  const statTasks = document.getElementById('stat-tasks');
  const statHours = document.getElementById('stat-hours');
  const statTeamAvatars = document.getElementById('stat-team-avatars');
  const statTeamSummary = document.getElementById('stat-team-summary');
  const statProgress = document.getElementById('stat-progress');
  const statWindowTarget = document.getElementById('stat-window-target');

  // Layout Panels
  const panelInputs = document.getElementById('panel-inputs');
  const workspaceLayout = document.querySelector('.workspace-layout');
  const outputPanel = document.querySelector('.output-panel');
  const panelAbout = document.getElementById('panel-about');

  milestoneInput.addEventListener('input', updateDashboardStats);
  employeesInput.addEventListener('input', () => {
    try {
      const nextEmployees = JSON.parse(employeesInput.value);
      if (!Array.isArray(nextEmployees) ||
        nextEmployees.some(employee => !employee || typeof employee !== 'object' || Array.isArray(employee))) {
        return;
      }
      employeesList = nextEmployees;
      updateDashboardStats();
    } catch {
      // Retain the last valid roster while the JSON editor is incomplete.
    }
  });

  // Modal Elements
  const configModal = document.getElementById('config-modal');
  const providerSelect = document.getElementById('provider-select');
  const modelSelect = document.getElementById('model-select');
  const apiKeyInput = document.getElementById('api-key-input');
  const saveConfigBtn = document.getElementById('save-config-btn');
  const refreshModelsBtn = document.getElementById('refresh-models-btn');
  const modelStatus = document.getElementById('model-status');
  const authToken = document.querySelector('meta[name="apm-auth-token"]')?.content;
  const apiFetch = (url, options = {}) => fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${authToken}`
    }
  });

  // Task Editor Modal Elements
  const taskModal = document.getElementById('task-modal');
  const editorTaskId = document.getElementById('editor-task-id');
  const editorTaskName = document.getElementById('editor-task-name');
  const editorTaskDesc = document.getElementById('editor-task-desc');
  const editorTaskAssignee = document.getElementById('editor-task-assignee');
  const editorTaskPriority = document.getElementById('editor-task-priority');
  const editorTaskStatus = document.getElementById('editor-task-status');
  const editorTaskStart = document.getElementById('editor-task-start');
  const editorTaskEnd = document.getElementById('editor-task-end');
  const editorTaskHours = document.getElementById('editor-task-hours');
  const editorTaskDeps = document.getElementById('editor-task-deps');
  const saveTaskBtn = document.getElementById('save-task-btn');
  const deleteTaskBtn = document.getElementById('delete-task-btn');
  let currentEditingTaskId = null;
  const taskStatuses = [
    ['not-started', 'Not started'],
    ['just-started', 'Just started'],
    ['in-progress', 'In progress'],
    ['testing', 'Testing'],
    ['debugging', 'Debugging'],
    ['client-review', 'Client review'],
    ['completed', 'Completed'],
    ['blocked', 'Blocked']
  ];

  function getStatusLabel(status) {
    return taskStatuses.find(([value]) => value === status)?.[1] || status;
  }

  // Navigation / Tabs
  const sidebarNavItems = document.querySelectorAll('.nav-item[data-nav]');
  const inputToggleButtons = document.querySelectorAll('.input-toggle-btn');
  const inputTabContents = document.querySelectorAll('.input-tab-content');
  
  const viewButtons = document.querySelectorAll('.view-btn');
  const viewPanels = document.querySelectorAll('.view-panel');

  // Load non-sensitive settings from LocalStorage
  providerSelect.value = localStorage.getItem('apm_provider') || 'gemini';
  let savedModel = localStorage.getItem('apm_model') || '';
  // Do not persist API keys in browser storage.
  apiKeyInput.value = '';

  // Centrally control output views and placeholder visibility based on tasks presence
  function refreshViewVisibility() {
    const hasData = tasksData && tasksData.length > 0;
    if (hasData) {
      placeholderText.classList.add('hidden');
      const activeView = document.querySelector('.view-btn.active').dataset.view;
      viewPanels.forEach(p => {
        if (p.id === activeView) {
          p.classList.remove('hidden-view');
        } else {
          p.classList.add('hidden-view');
        }
      });
    } else {
      placeholderText.classList.remove('hidden');
      viewPanels.forEach(p => p.classList.add('hidden-view'));
    }
  }

  // Sidebar navigation switching
  sidebarNavItems.forEach(item => {
    item.addEventListener('click', () => {
      sidebarNavItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const targetNav = item.dataset.nav;

      if (targetNav === 'nav-dashboard') {
        workspaceLayout.classList.remove('focused-view');
        panelAbout.style.display = 'none';
        panelInputs.style.display = 'flex';
        outputPanel.style.display = 'flex';
        refreshViewVisibility();
      } else if (targetNav === 'nav-timeline') {
        workspaceLayout.classList.add('focused-view');
        panelAbout.style.display = 'none';
        panelInputs.style.display = 'none';
        outputPanel.style.display = 'flex';
        switchOutputView('timeline-view');
        refreshViewVisibility();
      } else if (targetNav === 'nav-kanban') {
        workspaceLayout.classList.add('focused-view');
        panelAbout.style.display = 'none';
        panelInputs.style.display = 'none';
        outputPanel.style.display = 'flex';
        switchOutputView('kanban-view');
        refreshViewVisibility();
      } else if (targetNav === 'nav-files') {
        workspaceLayout.classList.remove('focused-view');
        panelAbout.style.display = 'none';
        panelInputs.style.display = 'flex';
        outputPanel.style.display = 'none';
      } else if (targetNav === 'nav-about') {
        workspaceLayout.classList.remove('focused-view');
        panelInputs.style.display = 'none';
        outputPanel.style.display = 'none';
        panelAbout.style.display = 'flex';
      }
    });
  });

  // Helper to switch visual views
  function switchOutputView(viewId) {
    viewButtons.forEach(btn => {
      if (btn.dataset.view === viewId) btn.classList.add('active');
      else btn.classList.remove('active');
    });
    viewPanels.forEach(p => {
      if (p.id === viewId) p.classList.remove('hidden-view');
      else p.classList.add('hidden-view');
    });
  }

  // Input tab switching (Milestone vs Employees textareas)
  inputToggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      inputToggleButtons.forEach(b => b.classList.remove('active'));
      inputTabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.inputTab).classList.add('active');
    });
  });

  // Output View tab buttons switching
  viewButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      viewButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      refreshViewVisibility();
    });
  });

  // Config settings modal toggles
  configBtn.addEventListener('click', () => configModal.classList.remove('hidden'));
  document.querySelectorAll('.close-modal').forEach(close => {
    close.addEventListener('click', () => {
      configModal.classList.add('hidden');
      taskModal.classList.add('hidden');
    });
  });

  let modelRequestId = 0;
  async function loadAvailableModels() {
    const requestId = ++modelRequestId;
    const provider = providerSelect.value;
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      modelSelect.replaceChildren(new Option('Enter an API key to load models', ''));
      modelSelect.disabled = true;
      refreshModelsBtn.disabled = false;
      modelStatus.textContent = 'Enter an API key, then load the models available to that account.';
      return;
    }

    refreshModelsBtn.disabled = true;
    modelSelect.disabled = true;
    modelSelect.replaceChildren(new Option('Loading models…', ''));
    modelStatus.textContent = `Loading models from ${providerSelect.selectedOptions[0].text}…`;
    try {
      const response = await apiFetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not load models.');
      if (requestId !== modelRequestId) return;

      const models = result.models || [];
      if (!models.length) throw new Error('No text-generation models are available to this API key.');
      modelSelect.replaceChildren(...models.map(model => new Option(model.name, model.id)));
      modelSelect.value = models.some(model => model.id === savedModel)
        ? savedModel
        : models[0].id;
      modelSelect.disabled = false;
      localStorage.setItem('apm_model', modelSelect.value);
      modelStatus.textContent = `${models.length} available models loaded.`;
    } catch (error) {
      if (requestId !== modelRequestId) return;
      modelSelect.replaceChildren(new Option('Could not load models', ''));
      modelStatus.textContent = error.message;
    } finally {
      if (requestId === modelRequestId) refreshModelsBtn.disabled = false;
    }
  }

  refreshModelsBtn.addEventListener('click', loadAvailableModels);
  providerSelect.addEventListener('change', () => {
    modelSelect.replaceChildren(new Option('Load models for this provider', ''));
    modelSelect.disabled = true;
    if (apiKeyInput.value.trim()) loadAvailableModels();
  });
  modelSelect.addEventListener('change', () => {
    if (modelSelect.value) {
      savedModel = modelSelect.value;
      localStorage.setItem('apm_model', savedModel);
    }
  });

  saveConfigBtn.addEventListener('click', async () => {
    localStorage.setItem('apm_provider', providerSelect.value);
    localStorage.setItem('apm_model', modelSelect.value);
    savedModel = modelSelect.value;
    await loadAvailableModels();
    if (modelSelect.value) configModal.classList.add('hidden');
    else configModal.classList.remove('hidden');
  });
  if (apiKeyInput.value.trim()) loadAvailableModels();

  // Load Workspace Defaults
  async function loadWorkspaceData() {
    try {
      const response = await apiFetch('/api/load-workspace');
      if (response.ok) {
        const data = await response.json();
        
        if (data.milestone) {
          milestoneInput.value = data.milestone;
        } else {
          // Provide some standard default template if empty
          milestoneInput.value = JSON.stringify({
            "PROJECT_ID": "PROJ-777",
            "MILESTONE_NAME": "Release V1 API Gateway",
            "MILESTONE_DESCRIPTION": "Implement routing, JWT auth, and rate limiting for User and Payment microservices.",
            "MILESTONE_OWNER": "Alice Smith",
            "MILESTONE_PRIORITY": "High",
            "MILESTONE_START": "2026-07-20",
            "MILESTONE_END": "2026-07-31"
          }, null, 2);
        }

        if (data.employees && data.employees.length > 0) {
          employeesList = data.employees;
          employeesInput.value = JSON.stringify(data.employees, null, 2);
        } else {
          const defaults = [
            { "Employee_ID": "EMP-001", "Employee_Name": "Alice Smith", "Email": "alice@company.com", "Role": "Backend Developer", "Department": "Engineering" },
            { "Employee_ID": "EMP-002", "Employee_Name": "Bob Johnson", "Email": "bob@company.com", "Role": "DevOps Engineer", "Department": "Infrastructure" },
            { "Employee_ID": "EMP-003", "Employee_Name": "Charlie Brown", "Email": "charlie@company.com", "Role": "Security Engineer", "Department": "Security" },
            { "Employee_ID": "EMP-004", "Employee_Name": "Dana Scully", "Email": "dana@company.com", "Role": "Technical Writer", "Department": "Product" }
          ];
          employeesList = defaults;
          employeesInput.value = JSON.stringify(defaults, null, 2);
        }
        
        populateAssigneeDropdown();
        
        if (data.tasks && data.tasks.length > 0) {
          tasksData = data.tasks;
          renderAllViews();
          saveBtn.disabled = false;
        }

        updateDashboardStats();
        refreshViewVisibility();
      }
    } catch (err) {
      console.error('Failed to load workspace files:', err);
    }
  }

  loadWorkspaceData();

  function populateAssigneeDropdown() {
    editorTaskAssignee.innerHTML = '';
    employeesList.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.Employee_ID;
      opt.textContent = `${e.Employee_Name} (${e.Role})`;
      editorTaskAssignee.appendChild(opt);
    });
  }

  // Helper to hash name for consistent color generation
  function getAvatarColor(name) {
    if (!name) return 'hsl(225, 75%, 55%)';
    const sum = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hue = (sum * 29) % 360;
    return `hsl(${hue}, 65%, 45%)`;
  }

  function getCapacityForecast() {
    const assignedIds = [...new Set(tasksData
      .filter(task => task && typeof task === 'object')
      .map(task => task.assigned_to)
      .filter(id => typeof id === 'string' && id.trim()))];
    const proficiencyCounts = { fresher: 0, 'mid-level': 0, senior: 0 };
    const multipliers = { fresher: 0.75, 'mid-level': 1, senior: 1.25 };
    let capacityHoursPerDay = 0;
    for (const id of assignedIds) {
      const employee = employeesList.find(item => item?.Employee_ID === id);
      if (!employee) continue;
      const level = Object.hasOwn(multipliers, employee.experience_level)
        ? employee.experience_level
        : 'mid-level';
      proficiencyCounts[level]++;
      capacityHoursPerDay += 8 * multipliers[level];
    }

    const estimatedHours = tasksData.reduce((total, task) => (
      task && Number.isFinite(task.estimated_hours) && task.estimated_hours > 0
        ? total + task.estimated_hours
        : total
    ), 0);
    let milestone = null;
    try {
      milestone = JSON.parse(milestoneInput.value);
    } catch {
      milestone = null;
    }
    const isDate = value => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const date = new Date(`${value}T00:00:00.000Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    const taskStart = tasksData
      .filter(task => task && typeof task === 'object' && isDate(task.start_date))
      .map(task => task.start_date)
      .sort()[0];
    const milestoneStart = milestone && typeof milestone === 'object'
      ? milestone.MILESTONE_START
      : '';
    const startDate = isDate(milestoneStart) ? milestoneStart : taskStart || null;
    const milestoneEnd = milestone && typeof milestone === 'object' && isDate(milestone.MILESTONE_END)
      ? milestone.MILESTONE_END
      : null;

    if (!startDate || !assignedIds.some(id => employeesList.some(employee => employee?.Employee_ID === id)) ||
      estimatedHours <= 0) {
      return {
        activeTeamCount: assignedIds.length,
        estimatedHours,
        capacityHoursPerDay,
        proficiencyCounts,
        workingDays: null,
        projectedStart: null,
        projectedEnd: null,
        milestoneEnd,
        exceedsMilestone: false
      };
    }

    const firstWeekday = value => {
      const date = new Date(`${value}T00:00:00.000Z`);
      while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
        date.setUTCDate(date.getUTCDate() + 1);
      }
      return date;
    };
    const workingDays = Math.ceil(estimatedHours / capacityHoursPerDay);
    const start = firstWeekday(startDate);
    const end = new Date(start);
    let remaining = workingDays - 1;
    while (remaining > 0) {
      end.setUTCDate(end.getUTCDate() + 1);
      if (end.getUTCDay() !== 0 && end.getUTCDay() !== 6) remaining--;
    }
    const projectedStart = start.toISOString().slice(0, 10);
    const projectedEnd = end.toISOString().slice(0, 10);
    return {
      activeTeamCount: assignedIds.length,
      estimatedHours,
      capacityHoursPerDay,
      proficiencyCounts,
      workingDays,
      projectedStart,
      projectedEnd,
      milestoneEnd,
      exceedsMilestone: Boolean(milestoneEnd && projectedEnd > milestoneEnd)
    };
  }

  // Update Stats Cards
  function updateDashboardStats() {
    statTasks.textContent = tasksData.length;
    const forecast = getCapacityForecast();
    const totalHours = Number.isInteger(forecast.estimatedHours)
      ? forecast.estimatedHours
      : forecast.estimatedHours.toFixed(1);
    statHours.textContent = `${totalHours}h`;

    // Dynamic Avatars
    statTeamAvatars.innerHTML = '';
    const activeUserIds = [...new Set(tasksData
      .filter(task => task && typeof task === 'object')
      .map(task => task.assigned_to)
      .filter(id => typeof id === 'string' && id))];
    
    if (activeUserIds.length === 0) {
      statTeamAvatars.innerHTML = '<span class="no-avatars-label">-</span>';
    } else {
      activeUserIds.forEach(id => {
        const emp = employeesList.find(e => e?.Employee_ID === id);
        const name = typeof emp?.Employee_Name === 'string' ? emp.Employee_Name : id;
        const level = ['fresher', 'mid-level', 'senior'].includes(emp?.experience_level)
          ? emp.experience_level
          : 'mid-level';
        const initials = name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
        
        const bubble = document.createElement('div');
        bubble.className = 'avatar-bubble';
        bubble.style.backgroundColor = getAvatarColor(name);
        bubble.title = `${name} (${id}) · ${level}`;
        bubble.textContent = initials;
        statTeamAvatars.appendChild(bubble);
      });
    }
    const { fresher, 'mid-level': midLevel, senior } = forecast.proficiencyCounts;
    statTeamSummary.textContent = forecast.activeTeamCount
      ? `${forecast.activeTeamCount} assigned · ${fresher} fresher · ${midLevel} mid · ${senior} senior`
      : 'No assigned team';

    const formatDate = value => {
      if (!value) return '';
      return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        timeZone: 'UTC'
      });
    };
    statProgress.textContent = forecast.projectedStart && forecast.projectedEnd
      ? `${formatDate(forecast.projectedStart)} - ${formatDate(forecast.projectedEnd)}${forecast.exceedsMilestone ? ' · Over target' : ''}`
      : tasksData.length ? 'Assign a team to forecast' : 'No active window';
    const targetEnd = forecast.milestoneEnd
      ? ` · target end ${formatDate(forecast.milestoneEnd)}`
      : '';
    statWindowTarget.textContent = forecast.projectedStart
      ? `${forecast.workingDays} weekdays · ${forecast.capacityHoursPerDay}h/day${targetEnd}`
      : forecast.activeTeamCount
        ? 'Add assigned employees to the project roster'
        : 'Assign tasks to calculate team capacity';
  }

  // Decompose Milestone Button action
  generateBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      alert('Please click "LLM Settings" in the sidebar and input your API Key first.');
      configModal.classList.remove('hidden');
      return;
    }
    if (!modelSelect.value) {
      alert('Open LLM Settings and load an available model before generating tasks.');
      configModal.classList.remove('hidden');
      return;
    }

    let milestoneContent = milestoneInput.value.trim();
    let employeesContent = employeesInput.value.trim();

    if (!milestoneContent) {
      alert('Milestone definition cannot be empty.');
      return;
    }

    let parsedEmployees = [];
    try {
      parsedEmployees = JSON.parse(employeesContent);
      employeesList = parsedEmployees;
      populateAssigneeDropdown();
    } catch (err) {
      alert('Failed to parse Employees list. Make sure it is a valid JSON array.');
      return;
    }

    // Toggle loader
    placeholderText.classList.add('hidden');
    loader.classList.remove('hidden');
    document.querySelectorAll('.view-panel').forEach(p => p.classList.add('hidden-view'));
    generateBtn.disabled = true;

    try {
      const payload = {
        milestone: milestoneContent,
        employees: parsedEmployees,
        provider: providerSelect.value,
        apiKey: key,
        model: modelSelect.value.trim()
      };

      const response = await apiFetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate tasks.');
      }

      const responseData = await response.json();
      tasksData = responseData.tasks || [];

      // Render
      renderAllViews();
      updateDashboardStats();
      refreshViewVisibility();
      saveBtn.disabled = false;
    } catch (err) {
      alert(`Generation failed: ${err.message}`);
      placeholderText.classList.remove('hidden');
    } finally {
      loader.classList.add('hidden');
      generateBtn.disabled = false;
    }
  });

  // Save JSON tasks action
  saveBtn.addEventListener('click', async () => {
    if (!tasksData.length) return;
    
    saveBtn.disabled = true;
    try {
      const response = await apiFetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tasks: tasksData })
      });

      if (response.ok) {
        const resData = await response.json();
        alert(`Successfully saved tasks back to workspace (${resData.path})!`);
      } else {
        throw new Error('Failed to save file.');
      }
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    } finally {
      saveBtn.disabled = false;
    }
  });

  // Rendering Views
  function renderAllViews() {
    renderTimelineView();
    renderKanbanView();
    renderTableView();
    renderAnalyticsView();
  }

  function getEmployeeName(id) {
    const emp = employeesList.find(e => e.Employee_ID === id);
    return emp ? emp.Employee_Name : id;
  }

  // --- Timeline (Gantt) View ---
  function renderTimelineView() {
    const daysGrid = document.getElementById('timeline-grid-days');
    const rowsContainer = document.getElementById('gantt-rows-container');

    daysGrid.innerHTML = '';
    rowsContainer.innerHTML = '';

    if (!tasksData.length) return;

    // Get min and max dates
    let minDateStr = '';
    let maxDateStr = '';

    tasksData.forEach(t => {
      if (!minDateStr || t.start_date < minDateStr) minDateStr = t.start_date;
      if (!maxDateStr || t.end_date > maxDateStr) maxDateStr = t.end_date;
    });

    const start = new Date(minDateStr);
    const end = new Date(maxDateStr);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return;
    }

    const timeDiff = end.getTime() - start.getTime();
    const totalDays = Math.ceil(timeDiff / (1000 * 3600 * 24)) + 1;

    // Build timeline ticks
    for (let i = 0; i < totalDays; i++) {
      const curr = new Date(start);
      curr.setDate(start.getDate() + i);
      const tick = document.createElement('div');
      tick.className = 'gantt-day-tick';
      const month = String(curr.getMonth() + 1).padStart(2, '0');
      const dateVal = String(curr.getDate()).padStart(2, '0');
      tick.textContent = `${month}/${dateVal}`;
      daysGrid.appendChild(tick);
    }

    // Build task rows
    tasksData.forEach(t => {
      const row = document.createElement('div');
      row.className = 'gantt-row';

      const labelCol = document.createElement('div');
      labelCol.className = 'gantt-task-label';
      labelCol.innerHTML = `<span>${escapeHtml(t.task_id)}</span>${escapeHtml(t.task_name)}`;
      labelCol.addEventListener('click', () => openTaskEditor(t.task_id));
      row.appendChild(labelCol);

      const barArea = document.createElement('div');
      barArea.className = 'gantt-bar-area';

      // Draw background vertical dashed gridlines inside row
      for (let i = 0; i < totalDays; i++) {
        const gridline = document.createElement('div');
        gridline.className = 'gantt-day-tick';
        gridline.style.position = 'absolute';
        gridline.style.left = `${i * 60}px`;
        gridline.style.height = '100%';
        gridline.style.borderLeft = '1px dashed hsla(220, 20%, 95%, 0.02)';
        barArea.appendChild(gridline);
      }

      // Calculate position offset and width
      const taskStart = new Date(t.start_date);
      const taskEnd = new Date(t.end_date);

      const offsetDiff = taskStart.getTime() - start.getTime();
      const offsetDays = Math.max(0, offsetDiff / (1000 * 3600 * 24));
      
      const durationDiff = taskEnd.getTime() - taskStart.getTime();
      const durationDays = Math.max(1, Math.ceil(durationDiff / (1000 * 3600 * 24)) + 1);

      const bar = document.createElement('div');
      bar.className = `gantt-bar bar-${escapeHtml(t.priority.toLowerCase())}`;
      bar.style.left = `${offsetDays * 60}px`;
      bar.style.width = `${durationDays * 60}px`;
      bar.textContent = `${escapeHtml(getEmployeeName(t.assigned_to))} (${escapeHtml(t.estimated_hours)}h)`;
      bar.title = `${escapeHtml(t.task_name)}\nAssignee: ${escapeHtml(getEmployeeName(t.assigned_to))}\nSchedule: ${escapeHtml(t.start_date)} to ${escapeHtml(t.end_date)}`;
      bar.addEventListener('click', () => openTaskEditor(t.task_id));

      barArea.appendChild(bar);
      row.appendChild(barArea);
      rowsContainer.appendChild(row);
    });
  }

  // --- Kanban View ---
  function renderKanbanView() {
    const listHigh = document.getElementById('list-high');
    const listMedium = document.getElementById('list-medium');
    const listLow = document.getElementById('list-low');

    listHigh.innerHTML = '';
    listMedium.innerHTML = '';
    listLow.innerHTML = '';

    tasksData.forEach(t => {
      const card = document.createElement('div');
      card.className = 'kanban-card';
      card.addEventListener('click', () => openTaskEditor(t.task_id));

      card.innerHTML = `
        <div class="card-header">
          <span>${escapeHtml(t.task_id)}</span>
          <span>${escapeHtml(t.start_date)} to ${escapeHtml(t.end_date)}</span>
        </div>
        <div class="card-title">${escapeHtml(t.task_name)}</div>
        <div class="card-desc">${escapeHtml(t.description || '')}</div>
        <div class="card-footer">
          <div class="card-assignee">${escapeHtml(getEmployeeName(t.assigned_to))}</div>
          <div class="card-hours">${escapeHtml(t.estimated_hours)}h</div>
        </div>
        <label class="card-status-control">Workflow status
          <select class="card-status-select" aria-label="Workflow status for ${escapeHtml(t.task_name)}">
            ${taskStatuses.map(([value, label]) => `<option value="${value}"${t.status === value ? ' selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
      `;
      const statusSelect = card.querySelector('.card-status-select');
      statusSelect.addEventListener('click', event => event.stopPropagation());
      statusSelect.addEventListener('change', event => {
        event.stopPropagation();
        updateTaskStatus(t.task_id, statusSelect.value);
      });

      if (t.priority.toLowerCase() === 'high') {
        listHigh.appendChild(card);
      } else if (t.priority.toLowerCase() === 'medium') {
        listMedium.appendChild(card);
      } else {
        listLow.appendChild(card);
      }
    });
  }

  // --- Table View ---
  function renderTableView() {
    const tableBody = document.getElementById('table-rows-container');
    tableBody.innerHTML = '';

    tasksData.forEach(t => {
      const row = document.createElement('tr');
      row.addEventListener('click', () => openTaskEditor(t.task_id));

      row.innerHTML = `
        <td><strong>${escapeHtml(t.task_id)}</strong></td>
        <td>${escapeHtml(t.task_name)}</td>
        <td>${escapeHtml(getEmployeeName(t.assigned_to))}</td>
        <td>${escapeHtml(t.start_date)} to ${escapeHtml(t.end_date)}</td>
        <td><span class="tag-priority tag-${escapeHtml(t.priority.toLowerCase())}">${escapeHtml(t.priority)}</span></td>
        <td><span class="task-status status-${escapeHtml(t.status)}">${escapeHtml(getStatusLabel(t.status))}</span></td>
        <td>${escapeHtml(t.estimated_hours)}</td>
        <td>${escapeHtml(t.dependencies && t.dependencies.length > 0 ? t.dependencies.join(', ') : '-')}</td>
      `;
      tableBody.appendChild(row);
    });
  }

  // --- Analytics View ---
  function renderAnalyticsView() {
    const statusChart = document.getElementById('analytics-status-chart');
    const workloadChart = document.getElementById('analytics-workload-chart');
    const healthSummary = document.getElementById('analytics-health-summary');

    if (!statusChart || !workloadChart || !healthSummary) return;

    if (!tasksData.length) {
      statusChart.innerHTML = '<p class="no-data-msg">No tasks generated yet. Decompose a milestone to see analytics.</p>';
      workloadChart.innerHTML = '<p class="no-data-msg">No tasks generated yet. Decompose a milestone to see analytics.</p>';
      healthSummary.innerHTML = '<p class="no-data-msg">No tasks generated yet. Decompose a milestone to see analytics.</p>';
      return;
    }

    // 1. Calculate workflow status distribution
    const statusCounts = Object.fromEntries(taskStatuses.map(([status]) => [status, 0]));
    tasksData.forEach(t => {
      if (statusCounts[t.status] !== undefined) statusCounts[t.status]++;
    });

    statusChart.innerHTML = `
      <div class="chart-bars">
        ${taskStatuses.map(([status, label]) => `
          <div class="chart-bar-item">
            <span class="bar-label">${label}</span>
            <div class="bar-track"><div class="bar-fill fill-allocation" style="width: ${(statusCounts[status] / tasksData.length) * 100}%"></div></div>
            <span class="bar-value">${statusCounts[status]} tasks (${Math.round((statusCounts[status] / tasksData.length) * 100)}%)</span>
          </div>
        `).join('')}
      </div>
    `;

    // 2. Calculate workload allocations per employee (assigned hours)
    const employeeHours = {};
    employeesList.forEach(e => {
      employeeHours[e.Employee_ID] = { name: e.Employee_Name, hours: 0, tasks: 0 };
    });

    tasksData.forEach(t => {
      if (employeeHours[t.assigned_to]) {
        employeeHours[t.assigned_to].hours += t.estimated_hours || 0;
        employeeHours[t.assigned_to].tasks++;
      }
    });

    let maxHours = 1;
    Object.values(employeeHours).forEach(eh => {
      if (eh.hours > maxHours) maxHours = eh.hours;
    });

    let workloadHtml = '<div class="chart-bars">';
    let hasAllocations = false;
    Object.values(employeeHours).forEach(eh => {
      if (eh.tasks > 0) {
        hasAllocations = true;
        workloadHtml += `
          <div class="chart-bar-item">
            <span class="bar-label">${escapeHtml(eh.name)}</span>
            <div class="bar-track"><div class="bar-fill fill-allocation" style="width: ${(eh.hours / maxHours) * 100}%"></div></div>
            <span class="bar-value">${eh.hours}h (${eh.tasks} tasks)</span>
          </div>
        `;
      }
    });
    workloadHtml += '</div>';

    if (!hasAllocations) {
      workloadChart.innerHTML = '<p class="no-data-msg">No resource allocations active.</p>';
    } else {
      workloadChart.innerHTML = workloadHtml;
    }

    // 3. Health Summary & Critical Path
    const totalHours = tasksData.reduce((sum, t) => sum + (t.estimated_hours || 0), 0);
    const avgHours = (totalHours / tasksData.length).toFixed(1);
    const depTasksCount = tasksData.filter(t => t.dependencies && t.dependencies.length > 0).length;

    healthSummary.innerHTML = `
      <div class="health-grid">
        <div class="health-stat-card">
          <span class="health-card-label">Average Task Size</span>
          <span class="health-card-val">${avgHours} hours</span>
        </div>
        <div class="health-stat-card">
          <span class="health-card-label">Interdependent Tasks</span>
          <span class="health-card-val">${depTasksCount} of ${tasksData.length}</span>
        </div>
        <div class="health-stat-card">
          <span class="health-card-label">Critical Path Estimate</span>
          <span class="health-card-val">${Math.ceil(totalHours * 0.75)} hours sequential</span>
        </div>
      </div>
    `;
  }

  // --- Task Detail Modal Editor ---
  function openTaskEditor(id) {
    const task = tasksData.find(t => t.task_id === id);
    if (!task) return;

    currentEditingTaskId = id;
    editorTaskId.textContent = id;
    editorTaskName.value = task.task_name;
    editorTaskDesc.value = task.description || '';
    editorTaskAssignee.value = task.assigned_to;
    editorTaskPriority.value = task.priority.toLowerCase();
    editorTaskStatus.value = task.status;
    editorTaskStart.value = task.start_date;
    editorTaskEnd.value = task.end_date;
    editorTaskHours.value = task.estimated_hours;
    editorTaskDeps.value = task.dependencies ? task.dependencies.join(', ') : '';

    taskModal.classList.remove('hidden');
  }

  saveTaskBtn.addEventListener('click', () => {
    if (!currentEditingTaskId) return;
    const taskIndex = tasksData.findIndex(t => t.task_id === currentEditingTaskId);
    if (taskIndex === -1) return;

    const deps = editorTaskDeps.value.trim()
      ? editorTaskDeps.value.split(',').map(d => d.trim()).filter(Boolean)
      : [];

    tasksData[taskIndex] = {
      ...tasksData[taskIndex],
      task_name: editorTaskName.value.trim(),
      description: editorTaskDesc.value.trim(),
      assigned_to: editorTaskAssignee.value,
      priority: editorTaskPriority.value,
      status: editorTaskStatus.value,
      start_date: editorTaskStart.value,
      end_date: editorTaskEnd.value,
      estimated_hours: parseInt(editorTaskHours.value, 10) || 0,
      dependencies: deps
    };

    taskModal.classList.add('hidden');
    renderAllViews();
    updateDashboardStats();
    saveBtn.disabled = false;
  });

  function updateTaskStatus(taskId, status) {
    const task = tasksData.find(item => item.task_id === taskId);
    if (!task || !taskStatuses.some(([value]) => value === status)) return;
    task.status = status;
    renderAllViews();
    updateDashboardStats();
    saveBtn.disabled = false;
  }

  deleteTaskBtn.addEventListener('click', () => {
    if (!currentEditingTaskId) return;
    if (confirm(`Are you sure you want to delete task ${currentEditingTaskId}?`)) {
      tasksData = tasksData.filter(t => t.task_id !== currentEditingTaskId);
      taskModal.classList.add('hidden');
      renderAllViews();
      updateDashboardStats();
      refreshViewVisibility();
    }
  });

  // --- Mobile Sidebar Toggle & Backdrop Overlay ---
  const sidebar = document.querySelector('.sidebar');
  const mainHeader = document.querySelector('.main-header');
  
  if (mainHeader && sidebar) {
    // Create menu button
    const mobileMenuBtn = document.createElement('button');
    mobileMenuBtn.id = 'mobile-menu-btn';
    mobileMenuBtn.className = 'mobile-menu-btn';
    mobileMenuBtn.innerHTML = '☰';
    mainHeader.insertBefore(mobileMenuBtn, mainHeader.firstChild);
    
    // Create overlay backdrop
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';
    document.body.appendChild(overlay);
    
    // Toggle sidebar
    mobileMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      sidebar.classList.toggle('show');
      overlay.classList.toggle('active');
    });
    
    // Close sidebar on backdrop click
    overlay.addEventListener('click', () => {
      sidebar.classList.remove('show');
      overlay.classList.remove('active');
    });
    
    // Close sidebar on clicking any sidebar nav items
    const navItems = sidebar.querySelectorAll('.nav-item');
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        sidebar.classList.remove('show');
        overlay.classList.remove('active');
      });
    });
  }
});
