package com.mlanh.personaltaskmanager

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.mlanh.personaltaskmanager.data.ApiException
import com.mlanh.personaltaskmanager.data.ProjectEntity
import com.mlanh.personaltaskmanager.data.TaskPayload
import com.mlanh.personaltaskmanager.data.TaskEntity
import com.mlanh.personaltaskmanager.data.TaskRepository
import com.mlanh.personaltaskmanager.sync.SyncScheduler
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TaskUiState(
    val loading: Boolean = false,
    val hasSession: Boolean = false,
    val user: com.mlanh.personaltaskmanager.data.User? = null,
    val projects: List<ProjectEntity> = emptyList(),
    val tasks: List<TaskEntity> = emptyList(),
    val error: String? = null,
    val selectedTask: TaskEntity? = null
)

class TaskViewModel(application: Application) : AndroidViewModel(application) {
    private val repository = TaskRepository(application)
    private val _state = MutableStateFlow(
        TaskUiState(hasSession = repository.hasSession(), user = repository.currentUser())
    )
    val state: StateFlow<TaskUiState> = _state.asStateFlow()

    init {
        if (_state.value.hasSession) {
            loadCacheAndSync()
            SyncScheduler.schedule(application)
        }
    }

    fun login(email: String, password: String) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            runCatching {
                val user = repository.login(email.trim(), password)
                val tasks = repository.sync()
                SyncScheduler.schedule(getApplication())
                user to tasks
            }.onSuccess { (user, tasks) ->
                _state.value = _state.value.copy(
                    loading = false,
                    hasSession = true,
                    user = user,
                    projects = repository.cachedProjects(),
                    tasks = tasks,
                    error = null
                )
            }.onFailure { error -> showError(error) }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            runCatching { repository.sync() }
                .onSuccess { tasks ->
                    _state.value = _state.value.copy(
                        loading = false,
                        projects = repository.cachedProjects(),
                        tasks = tasks,
                        error = null
                    )
                }
                .onFailure { error ->
                    // Offline mode intentionally retains the last cache.
                    _state.value = _state.value.copy(loading = false, error = error.message ?: "Chưa thể đồng bộ.")
                }
        }
    }

    fun toggle(task: TaskEntity) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            runCatching { repository.toggle(task) }
                .onSuccess { updated -> replaceTask(updated) }
                .onFailure { error -> showError(error) }
        }
    }

    fun create(title: String) {
        create(
            TaskPayload(
                projectId = null,
                title = title.trim(),
                description = null,
                status = "TODO",
                priority = "MEDIUM",
                deadlineType = "NONE",
                dueDate = null,
                dueAt = null
            )
        )
    }

    fun create(payload: TaskPayload) {
        if (payload.title.isBlank()) return
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            runCatching { repository.create(payload) }
                .onSuccess { created ->
                    _state.value = _state.value.copy(loading = false, tasks = listOf(created) + _state.value.tasks)
                }
                .onFailure { error -> showError(error) }
        }
    }

    fun update(task: TaskEntity, payload: TaskPayload) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            runCatching { repository.update(task.id, payload.copy(version = task.version)) }
                .onSuccess { updated -> replaceTask(updated) }
                .onFailure { error -> showError(error) }
        }
    }

    fun delete(task: TaskEntity) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            runCatching { repository.delete(task) }
                .onSuccess { _state.value = _state.value.copy(loading = false, tasks = _state.value.tasks.filter { it.id != task.id }) }
                .onFailure { error -> showError(error) }
        }
    }

    fun selectDeepLink(taskId: String?) {
        if (taskId == null || !_state.value.hasSession) return
        viewModelScope.launch {
            val cached = repository.cachedTask(taskId)
            if (cached != null) {
                _state.value = _state.value.copy(selectedTask = cached)
                return@launch
            }
            runCatching { repository.remoteTask(taskId) }
                .onSuccess { task -> _state.value = _state.value.copy(selectedTask = task) }
                .onFailure { error -> showError(error) }
        }
    }

    fun clearSelectedTask() {
        _state.value = _state.value.copy(selectedTask = null)
    }

    fun logout() {
        viewModelScope.launch {
            repository.logout()
            SyncScheduler.cancel(getApplication())
            _state.value = TaskUiState(hasSession = false)
        }
    }

    fun createProject(name: String, color: String?) {
        if (name.isBlank()) return
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            runCatching { repository.createProject(name.trim(), color) }
                .onSuccess { project ->
                    _state.value = _state.value.copy(loading = false, projects = _state.value.projects + project)
                }
                .onFailure { error -> showError(error) }
        }
    }

    fun updateProject(project: ProjectEntity) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            runCatching { repository.updateProject(project) }
                .onSuccess { updated ->
                    _state.value = _state.value.copy(
                        loading = false,
                        projects = _state.value.projects.map { if (it.id == updated.id) updated else it }
                    )
                }
                .onFailure { error -> showError(error) }
        }
    }

    fun deleteProject(project: ProjectEntity) {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            runCatching { repository.deleteProject(project) }
                .onSuccess {
                    _state.value = _state.value.copy(
                        loading = false,
                        projects = _state.value.projects.filter { it.id != project.id },
                        tasks = _state.value.tasks.map { if (it.projectId == project.id) it.copy(projectId = null) else it }
                    )
                }
                .onFailure { error -> showError(error) }
        }
    }

    private fun loadCacheAndSync() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true)
            _state.value = _state.value.copy(
                projects = repository.cachedProjects(),
                tasks = repository.cachedTasks(),
                loading = false
            )
            refresh()
        }
    }

    private fun replaceTask(updated: TaskEntity) {
        _state.value = _state.value.copy(loading = false, tasks = _state.value.tasks.map { if (it.id == updated.id) updated else it })
    }

    private fun showError(error: Throwable) {
        val message = if (error is ApiException && error.statusCode == 409) {
            "Dữ liệu đã thay đổi trên thiết bị khác. Hãy làm mới rồi thử lại."
        } else if (error is ApiException && error.statusCode == 401) {
            "Phiên đăng nhập không còn hợp lệ. Bạn có thể xem dữ liệu đã lưu và đăng nhập lại sau khi thoát."
        } else {
            error.message ?: "Có lỗi xảy ra."
        }
        _state.value = _state.value.copy(loading = false, error = message)
    }

    class Factory(private val application: Application) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T {
            return TaskViewModel(application) as T
        }
    }
}
