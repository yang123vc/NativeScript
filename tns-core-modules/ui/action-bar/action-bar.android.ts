import {AndroidActionBarSettings as AndroidActionBarSettingsDefinition, AndroidActionItemSettings} from "ui/action-bar";
import {ActionItemBase, ActionBarBase, isVisible} from "./action-bar-common";
import {isDefined, isNullOrUndefined, isString} from "utils/types";
import {View} from "ui/core/view";
import {RESOURCE_PREFIX} from "utils/utils";
import {fromFileOrResource} from "image-source";
import {AndroidActionItemPosition, AndroidActionBarIconVisibility} from "ui/enums";
import {colorProperty} from "ui/styling/style";
import {Color} from "color";
import * as application from "application";
import * as trace from "trace";

export * from "./action-bar-common";

const R_ID_HOME = 0x0102002c;
const ACTION_ITEM_ID_OFFSET = 1000;

let actionItemIdGenerator = ACTION_ITEM_ID_OFFSET;
function generateItemId(): number {
    actionItemIdGenerator++;
    return actionItemIdGenerator;
}

export class ActionItem extends ActionItemBase {
    private _androidPosition: AndroidActionItemSettings = {
        position: AndroidActionItemPosition.actionBar,
        systemIcon: undefined
    };

    private _itemId;
    constructor() {
        super();
        this._itemId = generateItemId();
    }

    public get android(): AndroidActionItemSettings {
        return this._androidPosition;
    }
    public set android(value: AndroidActionItemSettings) {
        throw new Error("ActionItem.android is read-only");
    }

    public _getItemId() {
        return this._itemId;
    }
}

export class AndroidActionBarSettings implements AndroidActionBarSettingsDefinition {
    private _actionBar: ActionBar;
    private _icon: string;
    private _iconVisibility: string = AndroidActionBarIconVisibility.auto;

    constructor(actionBar: ActionBar) {
        this._actionBar = actionBar;
    }

    public get icon(): string {
        return this._icon;
    }
    public set icon(value: string) {
        if (value !== this._icon) {
            this._icon = value;
            this._actionBar._onIconPropertyChanged();
        }
    }

    public get iconVisibility(): string {
        return this._iconVisibility;
    }
    public set iconVisibility(value: string) {
        if (value !== this._iconVisibility) {
            this._iconVisibility = value;
            this._actionBar._onIconPropertyChanged();
        }
    }
}

export class NavigationButton extends ActionItemBase {

}

export class ActionBar extends ActionBarBase {
    private _appResources: android.content.res.Resources;
    private _android: AndroidActionBarSettings;

    nativeView: android.support.v7.widget.Toolbar;

    constructor() {
        super();

        this._appResources = application.android.context.getResources();
        this._android = new AndroidActionBarSettings(this);
    }

    get android(): AndroidActionBarSettings {
        return this._android;
    }
    set android(value: AndroidActionBarSettings) {
        throw new Error("ActionBar.android is read-only");
    }

    public _createUI() {
        this.nativeView = new android.support.v7.widget.Toolbar(this._context);
        let ownerRef = new WeakRef(this);
        this.nativeView.setOnMenuItemClickListener(new android.support.v7.widget.Toolbar.OnMenuItemClickListener({
            onMenuItemClick: function (item: android.view.IMenuItem): boolean {
				let ownerValue = ownerRef.get();
                if (!ownerValue) {
                    return false;
                }
                let itemId = item.getItemId();
                return ownerValue._onAndroidItemSelected(itemId);
            }
        }));
    }

    public onLoaded() {
        super.onLoaded();
        this.update();
    }

    public update() {
        if (!this.nativeView) {
            return;
        }

        if (!this.page.frame || !this.page.frame._getNavBarVisible(this.page)) {
            this.nativeView.setVisibility(android.view.View.GONE);

            // If action bar is hidden - no need to fill it with items.
            return;
        }

        this.nativeView.setVisibility(android.view.View.VISIBLE);

        // Add menu items
        this._addActionItems();

        // Set title
        this._updateTitleAndTitleView();

        // Set home icon
        this._updateIcon();

        // Set navigation button
        this._updateNavigationButton();
    }

    public _onAndroidItemSelected(itemId: number): boolean {
        // Handle home button
        if (this.navigationButton && itemId === R_ID_HOME) {
            this.navigationButton._raiseTap();
            return true;
        }

        // Find item with the right ID;
        let menuItem: ActionItem = undefined;
        let items = this.actionItems.getItems();
        for (let i = 0; i < items.length; i++) {
            if ((<ActionItem>items[i])._getItemId() === itemId) {
                menuItem = <ActionItem>items[i];
                break;
            }
        }

        if (menuItem) {
            menuItem._raiseTap();
            return true;
        }

        return false;
    }

    public _updateNavigationButton() {
        let navButton = this.navigationButton;
        if (navButton && isVisible(navButton)) {
            if (navButton.android.systemIcon) {
                // Try to look in the system resources.
                let systemResourceId = getSystemResourceId(navButton.android.systemIcon);
                if (systemResourceId) {
                    this.nativeView.setNavigationIcon(systemResourceId);
                }
            }
            else if (navButton.icon) {
                let drawableOrId = getDrawableOrResourceId(navButton.icon, this._appResources);
                this.nativeView.setNavigationIcon(drawableOrId);
            }

            let navBtn = new WeakRef(navButton);
            this.nativeView.setNavigationOnClickListener(new android.view.View.OnClickListener({
                onClick: function (v) {
                    let owner = navBtn.get();
                    if (owner) {
                        owner._raiseTap();
                    }
                }
            }));
        }
        else {
            this.nativeView.setNavigationIcon(null);
        }
    }

    public _updateIcon() {
        let visibility = getIconVisibility(this.android.iconVisibility);
        if (visibility) {
            let icon = this.android.icon;
            if (isDefined(icon)) {
                let drawableOrId = getDrawableOrResourceId(icon, this._appResources);
                if (drawableOrId) {
                    this.nativeView.setLogo(drawableOrId);
                }
            }
            else {
                let defaultIcon = application.android.nativeApp.getApplicationInfo().icon;
                this.nativeView.setLogo(defaultIcon);
            }
        }
        else {
            this.nativeView.setLogo(null);
        }
    }

    public _updateTitleAndTitleView() {
        if (!this.titleView) {
            // No title view - show the title
            let title = this.title;
            if (isDefined(title)) {
                this.nativeView.setTitle(title);
            } else {
                let appContext = application.android.context;
                let appInfo = appContext.getApplicationInfo();
                let appLabel = appContext.getPackageManager().getApplicationLabel(appInfo);
                if (appLabel) {
                    this.nativeView.setTitle(appLabel);
                }
            }
        }
    }

    public _addActionItems() {
        let menu = this.nativeView.getMenu();
        let items = this.actionItems.getVisibleItems();

        menu.clear();
        for (let i = 0; i < items.length; i++) {
            let item = <ActionItem>items[i];
            let menuItem = menu.add(android.view.Menu.NONE, item._getItemId(), android.view.Menu.NONE, item.text + "");

            if (item.actionView && item.actionView.android) {
                // With custom action view, the menuitem cannot be displayed in a popup menu. 
                item.android.position = AndroidActionItemPosition.actionBar;
                menuItem.setActionView(item.actionView.android);
                ActionBar._setOnClickListener(item);
            }
            else if (item.android.systemIcon) {
                // Try to look in the system resources.
                let systemResourceId = getSystemResourceId(item.android.systemIcon);
                if (systemResourceId) {
                    menuItem.setIcon(systemResourceId);
                }
            }
            else if (item.icon) {
                let drawableOrId = getDrawableOrResourceId(item.icon, this._appResources);
                if (drawableOrId) {
                    menuItem.setIcon(drawableOrId);
                }
                else {
                    throw new Error("Error loading icon from " + item.icon);
                }
            }

            let showAsAction = getShowAsAction(item);
            menuItem.setShowAsAction(showAsAction);
        }
    }

    private static _setOnClickListener(item: ActionItem): void {
        item.actionView.android.setOnClickListener(new android.view.View.OnClickListener({
            onClick: function (v: android.view.View) {
                item._raiseTap();
            }
        }));
    }

    public _onTitlePropertyChanged() {
        if (this.nativeView) {
            this._updateTitleAndTitleView();
        }
    }

    public _onIconPropertyChanged() {
        if (this.nativeView) {
            this._updateIcon();
        }
    }

    public _clearAndroidReference() {
        // don't clear _android field!
        this.nativeView = undefined;
    }

    public _addViewToNativeVisualTree(child: View, atIndex?: number): boolean {
        super._addViewToNativeVisualTree(child);

        if (this.nativeView && child._nativeView) {
            if (isNullOrUndefined(atIndex) || atIndex >= this._nativeView.getChildCount()) {
                this.nativeView.addView(child._nativeView);
            }
            else {
                this.nativeView.addView(child._nativeView, atIndex);
            }
            return true;
        }

        return false;
    }

    public _removeViewFromNativeVisualTree(child: View): void {
        super._removeViewFromNativeVisualTree(child);

        if (this.nativeView && child._nativeView) {
            this.nativeView.removeView(child._nativeView);
            trace.notifyEvent(child, "childInLayoutRemovedFromNativeVisualTree");
        }
    }


    get [colorProperty.native](): Color {
        if (!defaultTitleTextColor) {
            let textView = new android.widget.TextView(this._context);
            let color = textView.getTextColors().getDefaultColor();
            defaultTitleTextColor = new Color(color);
        }

        return defaultTitleTextColor;
    }
    set [colorProperty.native](value: Color) {
        this.nativeView.setTitleTextColor(value.android);
    }
}

let defaultTitleTextColor: Color;

function getDrawableOrResourceId(icon: string, resources: android.content.res.Resources): any {
    if (!isString(icon)) {
        return undefined;
    }

    if (icon.indexOf(RESOURCE_PREFIX) === 0) {
        let resourceId: number = resources.getIdentifier(icon.substr(RESOURCE_PREFIX.length), 'drawable', application.android.packageName);
        if (resourceId > 0) {
            return resourceId;
        }
    }
    else {
        let drawable: android.graphics.drawable.BitmapDrawable;

        let is = fromFileOrResource(icon);
        if (is) {
            drawable = new android.graphics.drawable.BitmapDrawable(is.android);
        }

        return drawable;
    }

    return undefined;
}

function getShowAsAction(menuItem: ActionItem): number {
    switch (menuItem.android.position) {
        case AndroidActionItemPosition.actionBarIfRoom:
            return android.view.MenuItem.SHOW_AS_ACTION_IF_ROOM;

        case AndroidActionItemPosition.popup:
            return android.view.MenuItem.SHOW_AS_ACTION_NEVER;

        case AndroidActionItemPosition.actionBar:
        default:
            return android.view.MenuItem.SHOW_AS_ACTION_ALWAYS;
    }
}

function getIconVisibility(iconVisibility: string): boolean {
    switch (iconVisibility) {
        case AndroidActionBarIconVisibility.always:
            return true;

        case AndroidActionBarIconVisibility.auto:
        case AndroidActionBarIconVisibility.never:
        default:
            return false;
    }
}

function getSystemResourceId(systemIcon: string): number {
    return android.content.res.Resources.getSystem().getIdentifier(systemIcon, "drawable", "android");
}