package __PACKAGE__;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Data;
import androidx.work.ExistingWorkPolicy;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

// Written by Sprout's harvest. Notifications sent while the app runs in the
// background: shown now, or at their time. Scheduling again with the same key
// replaces the earlier one, like notify() on the Mac.
public class SproutNotifyWorker extends Worker {
    static final String CHANNEL = "sprout";

    public static void schedule(Context context, String key, String title, String body, long at) {
        Data data = new Data.Builder().putString("key", key).putString("title", title).putString("body", body).build();
        OneTimeWorkRequest request = new OneTimeWorkRequest.Builder(SproutNotifyWorker.class)
            .setInitialDelay(Math.max(0, at - System.currentTimeMillis()), TimeUnit.MILLISECONDS)
            .setInputData(data)
            .build();
        WorkManager.getInstance(context).enqueueUniqueWork("notify-" + key, ExistingWorkPolicy.REPLACE, request);
    }

    public static void cancel(Context context, String key) {
        WorkManager.getInstance(context).cancelUniqueWork("notify-" + key);
        NotificationManagerCompat.from(context).cancel(key.hashCode());
    }

    public SproutNotifyWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context context = getApplicationContext();
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (!manager.areNotificationsEnabled()) return Result.success();
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager system = context.getSystemService(NotificationManager.class);
            system.createNotificationChannel(new NotificationChannel(CHANNEL, "Alerts", NotificationManager.IMPORTANCE_DEFAULT));
        }
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tap = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        String key = getInputData().getString("key");
        String body = getInputData().getString("body");
        NotificationCompat.Builder note = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(context.getApplicationInfo().icon)
            .setContentTitle(getInputData().getString("title"))
            .setContentIntent(tap)
            .setAutoCancel(true);
        if (body != null && !body.isEmpty()) note.setContentText(body).setStyle(new NotificationCompat.BigTextStyle().bigText(body));
        try {
            manager.notify(key == null ? 0 : key.hashCode(), note.build());
        } catch (SecurityException notAllowed) {
            // The person hasn't allowed notifications.
        }
        return Result.success();
    }
}
