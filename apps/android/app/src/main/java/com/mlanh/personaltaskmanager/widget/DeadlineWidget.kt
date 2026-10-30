package com.mlanh.personaltaskmanager.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import androidx.glance.unit.sp
import androidx.glance.state.GlanceStateDefinition
import androidx.glance.state.PreferencesGlanceStateDefinition
import com.mlanh.personaltaskmanager.MainActivity
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.temporal.ChronoUnit

data class WidgetItem(val id: String, val bucket: String, val title: String, val label: String)

object DeadlineWidgetStore {
    private val itemsKey = androidx.datastore.preferences.core.stringPreferencesKey("items")
    private val syncedAtKey = androidx.datastore.preferences.core.stringPreferencesKey("synced_at")

    suspend fun save(context: Context, tasks: List<com.mlanh.personaltaskmanager.data.TaskEntity>, syncedAt: Instant) {
        val selected = select(tasks)
        val manager = GlanceAppWidgetManager(context)
        val ids = manager.getGlanceIds(DeadlineWidget::class.java)
        ids.forEach { id ->
            updateAppWidgetState(context, id) { preferences ->
                preferences[itemsKey] = encode(selected)
                preferences[syncedAtKey] = syncedAt.toString()
            }
            DeadlineWidget().update(context, id)
        }
    }

    suspend fun clear(context: Context) {
        val manager = GlanceAppWidgetManager(context)
        manager.getGlanceIds(DeadlineWidget::class.java).forEach { id ->
            updateAppWidgetState(context, id) { preferences ->
                preferences.remove(itemsKey)
                preferences.remove(syncedAtKey)
            }
            DeadlineWidget().update(context, id)
        }
    }

    private fun select(tasks: List<com.mlanh.personaltaskmanager.data.TaskEntity>): List<WidgetItem> {
        val active = tasks.filter { it.status != "DONE" }
        val overdue = active.filter { it.deadlineBucket == "OVERDUE" }
            .sortedWith(compareBy({ it.dueAt ?: it.dueDate ?: "" }, { it.priority }))
        val upcoming = active.filter { it.deadlineBucket == "TODAY" || it.deadlineBucket == "UPCOMING" }
            .filter { withinSevenDays(it) }
            .sortedWith(compareBy({ it.dueAt ?: it.dueDate ?: "" }, { it.priority }))

        val result = mutableListOf<com.mlanh.personaltaskmanager.data.TaskEntity>()
        if (overdue.isNotEmpty()) result += overdue.first()
        if (upcoming.isNotEmpty()) result += upcoming.first()
        (overdue.drop(1) + upcoming.drop(1)).sortedWith(compareBy({ it.dueAt ?: it.dueDate ?: "" }, { it.priority }))
            .forEach { task -> if (result.none { it.id == task.id }) result += task }
        return result.take(6).map { WidgetItem(it.id, it.deadlineBucket, it.title, it.relativeDeadline) }
    }

    private fun withinSevenDays(task: com.mlanh.personaltaskmanager.data.TaskEntity): Boolean {
        if (task.deadlineType == "DATE" && task.deadlineBucket == "TODAY") return true
        val due = task.dueAt?.let { runCatching { Instant.parse(it) }.getOrNull() }
            ?: task.dueDate?.let { runCatching { Instant.parse("${it}T00:00:00Z") }.getOrNull() }
            ?: return false
        return !due.isBefore(Instant.now()) && !due.isAfter(Instant.now().plus(7, ChronoUnit.DAYS))
    }

    private fun encode(items: List<WidgetItem>): String = JSONArray().apply {
        items.forEach { item ->
            put(JSONObject().put("id", item.id).put("bucket", item.bucket).put("title", item.title).put("label", item.label))
        }
    }.toString()

    fun decode(raw: String?): List<WidgetItem> {
        if (raw.isNullOrBlank()) return emptyList()
        val array = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        return (0 until array.length()).mapNotNull { index ->
            runCatching {
                val item = array.getJSONObject(index)
                WidgetItem(item.getString("id"), item.getString("bucket"), item.getString("title"), item.getString("label"))
            }.getOrNull()
        }
    }
}

class DeadlineWidget : GlanceAppWidget() {
    override val stateDefinition: GlanceStateDefinition<*> = PreferencesGlanceStateDefinition
    override val sizeMode = SizeMode.Responsive(
        setOf(DpSize(110.dp, 48.dp), DpSize(250.dp, 120.dp), DpSize(320.dp, 240.dp))
    )

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val preferences = currentState<androidx.datastore.preferences.core.Preferences>()
            val rawItems = preferences[androidx.datastore.preferences.core.stringPreferencesKey("items")]
            val syncedAt = preferences[androidx.datastore.preferences.core.stringPreferencesKey("synced_at")]
            val items = DeadlineWidgetStore.decode(rawItems)
            val maxItems = when {
                LocalSize.current.width < 180.dp -> 1
                LocalSize.current.width < 300.dp -> 3
                else -> 6
            }
            Column(
                modifier = GlanceModifier.fillMaxSize().padding(12.dp),
                verticalAlignment = Alignment.Top,
                horizontalAlignment = Alignment.Start
            ) {
                Text("Deadline", style = TextStyle(color = ColorProvider(androidx.compose.ui.graphics.Color(0xFF536DFE)), fontSize = 16.sp))
                Spacer(GlanceModifier.height(6.dp))
                if (items.isEmpty()) {
                    Text("Chưa có việc sắp đến hạn", style = TextStyle(fontSize = 13.sp))
                } else {
                    items.take(maxItems).forEach { item ->
                        Row(
                            modifier = GlanceModifier.fillMaxWidth().padding(vertical = 3.dp)
                                .clickable(actionRunCallback<OpenTaskAction>(actionParametersOf(taskIdKey to item.id))),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(if (item.bucket == "OVERDUE") "!" else "•", style = TextStyle(fontSize = 14.sp))
                            Spacer(GlanceModifier.width(6.dp))
                            Column {
                                Text(item.title, style = TextStyle(fontSize = 13.sp))
                                Text(item.label, style = TextStyle(fontSize = 11.sp))
                            }
                        }
                    }
                }
                if (syncedAt != null) {
                    Spacer(GlanceModifier.height(4.dp))
                    Text("Đồng bộ ${syncedAt.replace('T', ' ').take(16)}", style = TextStyle(fontSize = 9.sp))
                }
            }
        }
    }
}

class DeadlineWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = DeadlineWidget()
}

val taskIdKey = ActionParameters.Key<String>("task_id")

class OpenTaskAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val taskId = parameters[taskIdKey] ?: return
        context.startActivity(
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
                data = Uri.parse("ptm://task/$taskId")
            }
        )
    }
}
