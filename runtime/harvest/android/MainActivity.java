package __PACKAGE__;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Written by Sprout's harvest. Opening the app (re)schedules the background wake-up.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SproutBackgroundWorker.schedule(this, __BACKGROUND__);
    }
}
