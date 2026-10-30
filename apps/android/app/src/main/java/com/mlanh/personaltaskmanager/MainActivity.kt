package com.mlanh.personaltaskmanager

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mlanh.personaltaskmanager.data.ProjectEntity
import com.mlanh.personaltaskmanager.data.TaskEntity
import com.mlanh.personaltaskmanager.data.TaskPayload
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val deepLinkTaskId = intent?.data?.takeIf { it.scheme == "ptm" && it.host == "task" }?.pathSegments?.lastOrNull()
        setContent {
            val taskViewModel: TaskViewModel = viewModel(factory = TaskViewModel.Factory(application))
            PersonalTaskManagerApp(taskViewModel, deepLinkTaskId)
        }
    }
}

@Composable
private fun PersonalTaskManagerApp(viewModel: TaskViewModel, deepLinkTaskId: String?) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    LaunchedEffect(deepLinkTaskId, state.hasSession) {
        if (state.hasSession) viewModel.selectDeepLink(deepLinkTaskId)
    }
    MaterialTheme {
        if (!state.hasSession) LoginScreen(state.loading, state.error, viewModel::login)
        else TaskListScreen(state, viewModel)
    }
}

@Composable
private fun LoginScreen(loading: Boolean, error: String?, onLogin: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Column(
        modifier = Modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Text("Task Manager", style = MaterialTheme.typography.headlineMedium)
        Text("Đăng nhập để đồng bộ công việc", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(20.dp))
        OutlinedTextField(email, { email = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(password, { password = it }, label = { Text("Mật khẩu") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
        if (error != null) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        Spacer(Modifier.height(16.dp))
        Button(onClick = { onLogin(email, password) }, enabled = !loading && email.isNotBlank() && password.length >= 8, modifier = Modifier.fillMaxWidth()) {
            if (loading) CircularProgressIndicator()
            else Text("Đăng nhập")
        }
    }
}

@Composable
private fun TaskListScreen(state: TaskUiState, viewModel: TaskViewModel) {
    var quickTitle by remember { mutableStateOf("") }
    var editingTask by remember { mutableStateOf<TaskEntity?>(null) }
    var editorVisible by remember { mutableStateOf(false) }
    var editingProject by remember { mutableStateOf<ProjectEntity?>(null) }
    var projectEditorVisible by remember { mutableStateOf(false) }
    val timezone = state.user?.timezone ?: "Asia/Ho_Chi_Minh"

    Scaffold { padding ->
        Column(Modifier.fillMaxSize().padding(padding).padding(horizontal = 16.dp)) {
            Row(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Column {
                    Text("Công việc", style = MaterialTheme.typography.headlineSmall)
                    Text(state.user?.email ?: "Đang đăng nhập", style = MaterialTheme.typography.bodySmall)
                }
                Row {
                    TextButton(onClick = viewModel::refresh) { Text("Làm mới") }
                    TextButton(onClick = viewModel::logout) { Text("Thoát") }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(quickTitle, { quickTitle = it }, label = { Text("Task nhanh") }, modifier = Modifier.weight(1f), singleLine = true)
                Button(onClick = { viewModel.create(quickTitle); quickTitle = "" }, enabled = quickTitle.isNotBlank() && !state.loading) { Text("Thêm") }
            }
            Spacer(Modifier.height(12.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Projects", style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { editingProject = null; projectEditorVisible = true }) { Text("＋ Project") }
            }
            if (state.projects.isEmpty()) {
                Text("Chưa có Project", style = MaterialTheme.typography.bodySmall)
            } else {
                state.projects.forEach { project ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("• ${project.name}", modifier = Modifier.weight(1f))
                        TextButton(onClick = { editingProject = project; projectEditorVisible = true }) { Text("Sửa") }
                        TextButton(onClick = { viewModel.deleteProject(project) }) { Text("Xóa") }
                    }
                }
            }
            HorizontalDivider(Modifier.padding(vertical = 8.dp))
            if (state.error != null) Text(state.error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(vertical = 8.dp))
            if (state.loading && state.tasks.isEmpty()) CircularProgressIndicator(modifier = Modifier.padding(top = 24.dp))
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Danh sách Task", style = MaterialTheme.typography.titleMedium)
                        TextButton(onClick = { editingTask = null; editorVisible = true }) { Text("＋ Chi tiết") }
                    }
                }
                items(state.tasks, key = { it.id }) { task ->
                    TaskCard(
                        task = task,
                        onToggle = { viewModel.toggle(task) },
                        onEdit = { editingTask = task; editorVisible = true },
                        onDelete = { viewModel.delete(task) },
                        busy = state.loading
                    )
                }
            }
        }
    }

    if (editorVisible) {
        TaskEditorDialog(
            task = editingTask,
            projects = state.projects,
            timezone = timezone,
            onDismiss = { editorVisible = false },
            onSubmit = { payload ->
                if (editingTask == null) viewModel.create(payload) else viewModel.update(editingTask!!, payload)
                editorVisible = false
            }
        )
    }
    if (projectEditorVisible) {
        ProjectEditorDialog(
            project = editingProject,
            onDismiss = { projectEditorVisible = false },
            onSubmit = { name, color ->
                if (editingProject == null) viewModel.createProject(name, color)
                else viewModel.updateProject(editingProject!!.copy(name = name, color = color))
                projectEditorVisible = false
            }
        )
    }
    state.selectedTask?.let { task ->
        AlertDialog(
            onDismissRequest = viewModel::clearSelectedTask,
            title = { Text(task.title) },
            text = { Text("${task.deadlineLabel}\n\n${task.description ?: "Không có mô tả."}") },
            confirmButton = { TextButton(onClick = viewModel::clearSelectedTask) { Text("Đóng") } }
        )
    }
}

@Composable
private fun TaskCard(task: TaskEntity, onToggle: () -> Unit, onEdit: () -> Unit, onDelete: () -> Unit, busy: Boolean) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(12.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text(task.title, style = MaterialTheme.typography.titleMedium)
                    Text("${task.relativeDeadline} · ${task.priority}")
                    if (task.description != null) Text(task.description, style = MaterialTheme.typography.bodySmall)
                }
                Text(if (task.status == "DONE") "Đã xong" else task.status, style = MaterialTheme.typography.labelMedium)
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onEdit, enabled = !busy) { Text("Sửa") }
                OutlinedButton(onClick = onToggle, enabled = !busy) { Text(if (task.status == "DONE") "Mở lại" else "Xong") }
                TextButton(onClick = onDelete, enabled = !busy) { Text("Xóa") }
            }
        }
    }
}

@Composable
private fun TaskEditorDialog(
    task: TaskEntity?,
    projects: List<ProjectEntity>,
    timezone: String,
    onDismiss: () -> Unit,
    onSubmit: (TaskPayload) -> Unit
) {
    var title by remember(task?.id) { mutableStateOf(task?.title ?: "") }
    var description by remember(task?.id) { mutableStateOf(task?.description ?: "") }
    var status by remember(task?.id) { mutableStateOf(task?.status ?: "TODO") }
    var priority by remember(task?.id) { mutableStateOf(task?.priority ?: "MEDIUM") }
    var projectId by remember(task?.id) { mutableStateOf(task?.projectId) }
    var deadlineType by remember(task?.id) { mutableStateOf(task?.deadlineType ?: "NONE") }
    var dueDate by remember(task?.id) { mutableStateOf(task?.dueDate ?: "") }
    var dueTime by remember(task?.id) { mutableStateOf(task?.dueAt?.let { displayTime(it, timezone) } ?: "09:00") }
    val dialogScroll = rememberScrollState()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (task == null) "Tạo Task" else "Sửa Task") },
        text = {
            Column(Modifier.verticalScroll(dialogScroll), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(title, { title = it }, label = { Text("Tiêu đề") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(description, { description = it }, label = { Text("Mô tả") }, modifier = Modifier.fillMaxWidth(), minLines = 2)
                ChoiceField("Trạng thái", status, listOf("TODO", "IN_PROGRESS", "DONE")) { status = it }
                ChoiceField("Ưu tiên", priority, listOf("LOW", "MEDIUM", "HIGH")) { priority = it }
                ChoiceField("Project", projectId ?: "NONE", listOf("NONE") + projects.map { it.id }) { projectId = it.takeUnless { value -> value == "NONE" } }
                ChoiceField("Deadline", deadlineType, listOf("NONE", "DATE", "DATETIME")) {
                    deadlineType = it
                    if (it == "NONE") { dueDate = ""; dueTime = "09:00" }
                }
                if (deadlineType != "NONE") {
                    OutlinedTextField(dueDate, { dueDate = it }, label = { Text("Ngày YYYY-MM-DD") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                }
                if (deadlineType == "DATETIME") {
                    OutlinedTextField(dueTime, { dueTime = it }, label = { Text("Giờ HH:mm ($timezone)") }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val dueAt = if (deadlineType == "DATETIME") toIso(dueDate, dueTime, timezone) else null
                    onSubmit(TaskPayload(projectId, title.trim(), description.trim().ifBlank { null }, status, priority, deadlineType, dueDate.takeIf { deadlineType == "DATE" }, dueAt, task?.version))
                },
                enabled = title.isNotBlank() && (deadlineType == "NONE" || dueDate.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) && (deadlineType != "DATETIME" || (dueTime.matches(Regex("\\d{2}:\\d{2}")) && toIso(dueDate, dueTime, timezone) != null))
            ) { Text("Lưu") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Hủy") } }
    )
}

@Composable
private fun ProjectEditorDialog(project: ProjectEntity?, onDismiss: () -> Unit, onSubmit: (String, String?) -> Unit) {
    var name by remember(project?.id) { mutableStateOf(project?.name ?: "") }
    var color by remember(project?.id) { mutableStateOf(project?.color ?: "#536DFE") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (project == null) "Tạo Project" else "Sửa Project") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(name, { name = it }, label = { Text("Tên Project") }, singleLine = true)
                OutlinedTextField(color, { color = it }, label = { Text("Màu tùy chọn") }, singleLine = true)
            }
        },
        confirmButton = { Button(onClick = { onSubmit(name.trim(), color.trim().ifBlank { null }) }, enabled = name.isNotBlank()) { Text("Lưu") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Hủy") } }
    )
}

@Composable
private fun ChoiceField(label: String, value: String, choices: List<String>, onSelect: (String) -> Unit) {
    var expanded by remember(label, value) { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { expanded = true }, modifier = Modifier.fillMaxWidth()) {
            Text("$label: $value")
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            choices.forEach { choice ->
                DropdownMenuItem(text = { Text(choice) }, onClick = { expanded = false; onSelect(choice) })
            }
        }
    }
}

private fun displayTime(iso: String, timezone: String): String = runCatching {
    val local = java.time.Instant.parse(iso).atZone(ZoneId.of(timezone)).toLocalTime()
    local.format(DateTimeFormatter.ofPattern("HH:mm"))
}.getOrDefault("09:00")

private fun toIso(date: String, time: String, timezone: String): String? = runCatching {
    LocalDateTime.parse("${date}T${time}").atZone(ZoneId.of(timezone)).toInstant().toString()
}.getOrNull()
