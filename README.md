# Export Service

This project is a Node based export service that takes URL's and turns them into images or pdf exports.  


## How to run

1. npm install
2. tsc
3. update `ADD ./08-05-2016_Chromium-Headless-5.tar.gz /root/export-app` line in the Dockerfile with the location of your Chrome headless binary.
4. docker build .
5. docker run -p 3000:3000 {machine number form build step}
6. Make post request with url and export type (default is image)

## Notes

If you need help building the chrome headless binary you can see [this article][chrome] which details how to build it.

[chrome]: http://www.zackarychapple.guru/chrome/2016/08/24/chrome-headless.html
