const instagram = require('instagram-private-api');
const Bluebird = require('bluebird');
const inquirer = require('inquirer');
const fs = require('fs');
const fetch = require('node-fetch');


if (!fs.existsSync('download/')) fs.mkdirSync('download');

var ig;

(async () => {
    const {igUser} = await inquirer.prompt([{
        type: 'input',
        name: 'igUser',
        message: 'Username:'
    }]);
    const {igPass} = await inquirer.prompt([{
        type: 'password',
        name: 'igPass',
        message: 'Password:'
    }]);
    ig = new instagram.IgApiClient();
    ig.state.generateDevice(igUser);
    await ig.qe.syncLoginExperiments();
    Bluebird.try(async () => {
        const auth = await ig.account.login(igUser, igPass);
        console.log('Logged in as', auth.full_name);
        console.log('\n');
    }).catch(instagram.IgCheckpointError, async () => {
        console.log(ig.state.checkpoint);
        await ig.challenge.auto(true);
        console.log(ig.state.checkpoint);
        const { code } = await inquirer.prompt([
            {
                type: 'input',
                name: 'code',
                message: 'Enter code',
            },
        ]);
        console.log(await ig.challenge.sendSecurityCode(code));
    }).catch(e => console.log('Could not resolve checkpoint:', e, e.stack)).then(async () => {
        const accountsFollowing = await getAllFollowing();
        for(account of accountsFollowing){
            await fs.promises.mkdir(`download/${account.pk}/posts/`, {recursive: true}).catch(err => {return});
            await fs.promises.writeFile(`download/${account.pk}/${account.username}`, '').catch(err => {return});
            console.log('Gathering posts from', account.username);
            const userPosts = await getAllPosts(account.pk).catch(err => {
                console.error('Error getting posts for', account.username);
            });
            let savedPosts = await fs.promises.readdir(`download/${account.pk}/posts/`);
            
            switch(userPosts.length){
                case 0:
                    console.log(account.username, 'has 0 posts');
                    break;
                case 1:
                    console.log('Saving 1 post from', account.username);
                    break;
                default:
                    console.log('Saving', userPosts.length, 'posts from', account.username);
            }
            let postsLeft = userPosts.length;
            for(post of userPosts){
                process.stdout.cursorTo(0);
                if(postsLeft > 0) process.stdout.write('Posts left: ' + postsLeft);
                if(savedPosts.includes(`${post.pk}`)) continue;
                await fs.promises.mkdir(`download/${account.pk}/posts/${post.pk}/`, {recursive: true}).catch(err => {return});
                await fs.promises.writeFile(`download/${account.pk}/posts/${post.pk}/info.json`, JSON.stringify(post, null, 4)).catch(err => {console.error(err)});
                if(post.image_versions2 != undefined){
                    let postMedia = await fetchMedia(post);
                    await fs.promises.writeFile(`download/${account.pk}/posts/${post.pk}/${postMedia.filename}`, postMedia.data).catch(err => {console.error(err)});
                }else if(post.carousel_media != undefined){
                    for(postPart of post.carousel_media){
                        let postMedia = await fetchMedia(postPart);
                        await fs.promises.writeFile(`download/${account.pk}/posts/${post.pk}/${postMedia.filename}`, postMedia.data).catch(err => {console.error(err)});
                    }
                }
                postsLeft--;
                process.stdout.clearLine();
            }
            process.stdout.write('\n');
        }
    });

})();

function getAllFollowing(pk){
    return new Promise((resolve, reject) => {
        const allFollowing = [];
        ig.feed.accountFollowing().items$.subscribe({
            next(currentFollowing) {
                allFollowing.push(...currentFollowing);
            },
            error(e) {
                reject(e);
            },
            complete() {
                resolve(allFollowing);
            },
        });
    });
}

function getAllPosts(pk){
    return new Promise((resolve, reject) => {
        const allPosts = [];
        ig.feed.user(pk).items$.subscribe({
            next(currentPosts) {
                allPosts.push(...currentPosts);
            },
            error(e) {
                reject(e);
            },
            complete() {
                resolve(allPosts);
            },
        });
    });
}

function fetchMedia(media){
    var url;
    var filename;
    switch (media.media_type) {
        case 1:
            url = media.image_versions2.candidates[0].url;
            filename = media.pk + '.jpeg';
            break;
        case 2:
            url = media.video_versions[0].url;
            filename = media.pk + '.mp4';
            break;
        default:
            return;
    }
    return new Promise(
        async (resolve, reject) => {
            const mediaResponse = await fetch(url, {
                headers: {
                    'Accept-Encoding': 'gzip',
                    'Connection': 'close',
                    'X-FB-HTTP-Engine': 'Liger',
                    'User-Agent': ig.state.appUserAgent
                },
                redirect: 'follow'
            }).catch(err => {
                if(err) reject(err);
            });
            const media = await mediaResponse.buffer().catch(err => {
                reject(err);
            });
            resolve({filename: filename, data: media});
        }
    );
} 