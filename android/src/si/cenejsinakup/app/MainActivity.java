package si.cenejsinakup.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

public final class MainActivity extends Activity {
    private static final Uri SHOPPING_URL =
        Uri.parse("https://kladivo1405.github.io/Cenej-iNakup/");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Custom Tabs share the user's browser session and let Google handle OAuth.
        Intent browser = new Intent(Intent.ACTION_VIEW, SHOPPING_URL);
        browser.addCategory(Intent.CATEGORY_BROWSABLE);
        Bundle options = new Bundle();
        options.putBinder("android.support.customtabs.extra.SESSION", null);
        options.putInt("android.support.customtabs.extra.TOOLBAR_COLOR", 0xff101512);
        options.putInt("android.support.customtabs.extra.TITLE_VISIBILITY", 1);
        browser.putExtras(options);

        try {
            startActivity(browser);
            finish();
        } catch (ActivityNotFoundException error) {
            new AlertDialog.Builder(this)
                .setTitle("CenejšiNakup")
                .setMessage("Za odpiranje aplikacije namesti spletni brskalnik.")
                .setPositiveButton("Zapri", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        finish();
                    }
                })
                .setCancelable(false)
                .show();
        }
    }
}
