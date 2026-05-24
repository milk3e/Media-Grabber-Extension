Current Version: **1.1**

This extension is used for viewing all cached media (images, gifs, videos, audio) on a webpage, downloading them individually or downloading them in bulk, and allowing bulk download to differentiate them by their file type and folder path.

**This extension is known to support Firefox, Firefox forks, Google Chrome, and Chromium.** It has not been tested on mobile.

**How To Install (Firefox / Firefox forks)**
- *Since this is a raw, unpackaged extension, it requires a setting to be changed to allow it. If you are not using Firefox Nightly/Dev or a fork, you may not have this setting available.*
1. From the files above, click media-grabber.zip, then click the download button. (Having it be .zip is necessary as Firefox may not allow just a raw folder.)
2. Go to ```about:config``` in your address bar, then search for ```xpinstall.signatures.required``` and set it to false.
3. Go to ```about:addons```, drag-and-drop media-grabber.zip into the page.

**How To Install (Google Chrome / Chromium)**
1. From the files above, click the green 'Code' button, and download as zip. Extract the media-grabber folder found in the Media-Grabber-Extension-main folder.
2. Go to ```chrome://extensions/``` in your address bar, and enable the Developer Mode switch in the top right.
3. Click 'Load unpacked' and go in the media-grabber folder, then click Open.

**Useage Guide**
1. Click it while it is pinned to the toolbar to open its menu. While in a page with media loading/cached, it will display there.
2. If two or more media files share the same filepath, they can be isolated by selecting the filepath in the "All Shared Folder Paths" dropdown.
3. To individually download a media file, simply click the download button next to it, and you can right click and save it. To bulk download everything in the current filter, click Download Filtered as ZIP.

*Coded by [Google Gemini](https://gemini.google.com) and [Claude](https://claude.com), then edited by me.*

*This project has a MIT license because it uses [jszip](https://cdnjs.com/libraries/jszip) to handle zipping bulk downloads, which uses a MIT license.*
