package com.entretienlapointe.tracker;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Le plugin de l'application (permission « notifications », étape 18) : enregistré AVANT super.onCreate, comme l'exige Capacitor
        registerPlugin(NotificationPermissionPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
