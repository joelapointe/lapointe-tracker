package com.entretienlapointe.tracker;

import android.Manifest;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Étape 18, partie 2 : la permission « notifications » d'Android 13 et plus.
 *
 * Pendant une passe, le suivi de la position du camion (application en arrière-plan ou écran éteint) affiche une notification permanente
 * « Lapointe Tracker — Passe en cours : la position du camion est partagée ». Sous Android 13 et plus, cette notification reste CACHÉE tant que la personne
 * n'a pas accordé la permission « notifications » : l'application la demande à l'écran, au début de la passe (tracking.js).
 * Sous Android 12 et moins, cette permission n'existe pas : elle est toujours « accordée ».
 *
 * Deux méthodes, appelées depuis la page (Capacitor.Plugins.NotificationPermission) :
 *   check()   -> { notifications: "granted" | "denied" | "prompt" | "prompt-with-rationale" }
 *   request() -> ouvre la boîte de dialogue du téléphone si la permission n'a pas encore été décidée, puis répond comme check()
 */
@CapacitorPlugin(
    name = "NotificationPermission",
    permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class NotificationPermissionPlugin extends Plugin {

    @PluginMethod
    public void check(PluginCall call) {
        call.resolve(etat());
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(etat());
            return;
        }
        requestPermissionForAlias("notifications", call, "apresLaDemande");
    }

    @PermissionCallback
    private void apresLaDemande(PluginCall call) {
        call.resolve(etat());
    }

    private JSObject etat() {
        JSObject r = new JSObject();
        r.put("notifications", Build.VERSION.SDK_INT < 33 ? "granted" : getPermissionState("notifications").toString());
        return r;
    }
}
