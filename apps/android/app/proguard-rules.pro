# The first sideloaded build does not enable shrinking. Keep this file so a
# future release build has a stable place for rules required by Room/Glance.
-keep class * implements androidx.glance.appwidget.action.ActionCallback { public <init>(); }
