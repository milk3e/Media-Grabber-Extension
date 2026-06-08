# Media Grabber (Version 2.4)
<img width="64" height="64" alt="media-grabber" src="https://github.com/user-attachments/assets/f4d94813-a4e2-4030-aab8-da0ea87d96c0" /> *Icon by [projectile-vomit](https://github.com/projectile-vomit)*

This is a browser extension used for viewing all media and hidden media (images, gifs, videos, audio) on a webpage, downloading them individually or in bulk, and filtering by type and file path.

This extension is known to support Chromium (Google Chrome, Brave, etc) and Firefox (LibreWolf, etc), but it likely supports more browsers like Edge, they just haven't been tested. It has not been tested on mobile, and it may be more difficult to put an unpacked extension on mobile as most mobile browsers don't support it.

**How to Install for Chromium (Google Chrome, Brave, etc)**
1. From the files above, click the green 'Code' button, and download as zip. Extract the media-grabber folder found in the Media-Grabber-Extension-main folder.
2. Go to ```chrome://extensions/``` in your address bar, and enable the Developer Mode switch in the top right.
3. Click 'Load unpacked' and go in the media-grabber folder, then click Open.
- *It's important you keep the media-grabber folder in a place to keep, as the browser directly uses that folder.*

**How to Install for Firefox (LibreWolf, etc)**
- *Since this is a raw, unpackaged extension, it requires a setting to be changed to allow it. Some versions of Firefox may not have this setting available.*
1. From the files above, click the green 'Code' button, and download as zip. Extract the media-grabber folder found in the Media-Grabber-Extension-main folder.
2. Compress the files in media-grabber into a .zip (not the folder itself, just its contents).
3. Go to ```about:config``` in your address bar, then search for ```xpinstall.signatures.required``` and set it to false.
4. Go to ```about:addons```, drag-and-drop media-grabber.zip into the page. On the page, a popup is made, click the 'Add' button.

**Useage Guide**
1. Click it while it is pinned to the toolbar to open its menu. While on a page with media, it will display its media.
2. Click the Type and Path buttons to isolate specific media.
3. To individually download a media file, click the download button next to it to open it in a new tab, and you can right click and save it. To bulk download everything in the current filter, click Download Filtered as ZIP.
4. To find media that isn't loaded raw, you can press Deep Scan to try to find anything hidden. (Some browsers may have issues individually downloading embedded blob data, but can still download them as zip.)

*Coded by [Google Gemini](https://gemini.google.com) and [Claude](https://claude.com), then edited by me.*

*This project has a MIT license because it uses [jszip](https://stuk.github.io/jszip/) to handle zipping bulk downloads, which uses a MIT license.*
