# Media Grabber Extension (Version 2.2)
This extension is used for viewing all media (images, gifs, videos, audio) on a webpage, downloading them individually or downloading them in bulk, and allowing bulk download to differentiate them by their file type and folder path. Has scanning capabilities to find hidden media.

**This extension is known to support Firefox, Firefox forks, Google Chrome, and Chromium.** It has not been tested on mobile.

**How to Install (Google Chrome / Chromium)**
1. From the files above, click the green 'Code' button, and download as zip. Extract the media-grabber folder found in the Media-Grabber-Extension-main folder.
2. Go to ```chrome://extensions/``` in your address bar, and enable the Developer Mode switch in the top right.
3. Click 'Load unpacked' and go in the media-grabber folder, then click Open.
- *It's important you keep the media-grabber folder in a place to keep, as Google Chrome / Chromium directly uses that folder.*

**How to Install (Firefox / Firefox forks)**
- *Since this is a raw, unpackaged extension, it requires a setting to be changed to allow it. If you are not using Firefox Nightly/Dev or a fork, you may not have this setting available, however this has not been proven to be true and may work anyway.*
1. From the files above, click the green 'Code' button, and download as zip. Extract the media-grabber folder found in the Media-Grabber-Extension-main folder.
2. Compress the files in media-grabber into a .zip (not the folder itself, just its contents like the .js .json and .html files).
3. Go to ```about:config``` in your address bar, then search for ```xpinstall.signatures.required``` and set it to false.
4. Go to ```about:addons```, drag-and-drop media-grabber.zip into the page. On the page, a popup is made, click the 'Add' button.

**Useage Guide**
1. Click it while it is pinned to the toolbar to open its menu. While on a page with media, it will display there.
2. If two or more media files share the same filepath, they can be isolated by selecting the filepath in the "All Shared Folder Paths" dropdown.
3. To individually download a media file, simply click the download button next to it to open it in a new tab, and you can right click and save it. To bulk download everything in the current filter, click Download Filtered as ZIP.
4. To find media that isn't loaded raw, you can press Deep Scan to try to find anything hidden.

*Coded by [Google Gemini](https://gemini.google.com) and [Claude](https://claude.com), then edited by me.*

*This project has a MIT license because it uses [jszip](https://cdnjs.com/libraries/jszip) to handle zipping bulk downloads, which uses a MIT license.*
