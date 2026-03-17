#!/usr/bin/env node
/**
 * 订阅号发布脚本
 * 
 * 使用微信「发布」接口 (freepublish/submit) 直接发布文章
 * 适用于没有草稿箱接口权限的订阅号
 * 
 * 注意：发布接口与草稿箱接口的区别：
 * - 草稿箱：保存到草稿，可预览编辑后再发布（仅服务号可用）
 * - 发布接口：直接发布，无需草稿箱权限（订阅号和服务号都可用）
 * 
 * 参考文档：https://developers.weixin.qq.com/doc/offiaccount/Publish/Publish.html
 */

require('dotenv').config();
const axios = require('axios');
const FormData = require('form-data');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const APPID = process.env.WECHAT_APPID;
const APPSECRET = process.env.WECHAT_APPSECRET;

/**
 * 获取 Access Token
 */
async function getAccessToken() {
  console.log('🔑 获取 access_token...');
  const resp = await axios.get('https://api.weixin.qq.com/cgi-bin/token', {
    params: {
      grant_type: 'client_credential',
      appid: APPID,
      secret: APPSECRET
    }
  });
  
  if (resp.data.errcode) {
    throw new Error(`获取 Token 失败: ${resp.data.errmsg}`);
  }
  
  console.log('   ✓ Token 获取成功');
  return resp.data.access_token;
}

/**
 * 上传永久素材（封面图片）
 */
async function uploadCoverImage(token, imagePath) {
  console.log('\n📤 上传封面图片...');
  
  const form = new FormData();
  form.append('media', fs.createReadStream(imagePath));
  
  const resp = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=image`,
    form,
    { headers: form.getHeaders() }
  );
  
  if (resp.data.errcode) {
    throw new Error(`封面上传失败: ${resp.data.errmsg}`);
  }
  
  console.log('   ✓ 封面上传成功');
  console.log('   media_id:', resp.data.media_id);
  return resp.data.media_id;
}

/**
 * 上传图文消息内的图片获取 URL
 * 用于正文中的图片
 */
async function uploadContentImage(token, imagePath) {
  const form = new FormData();
  form.append('media', fs.createReadStream(imagePath));
  
  const resp = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`,
    form,
    { headers: form.getHeaders() }
  );
  
  if (resp.data.errcode) {
    throw new Error(`图片上传失败: ${resp.data.errmsg}`);
  }
  
  return resp.data.url;
}

/**
 * 创建草稿（草稿箱接口，服务号可用）
 */
async function createDraft(token, article) {
  console.log('\n📝 创建草稿...');
  
  const payload = {
    articles: [article]
  };
  
  const resp = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`,
    JSON.stringify(payload),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    }
  );
  
  if (resp.data.errcode === 48001 || resp.data.errcode === 40007) {
    console.log('   ⚠️ 草稿箱接口不可用（订阅号限制）');
    console.log('   将尝试使用「发布」接口...');
    return null;
  }
  
  if (resp.data.errcode) {
    throw new Error(`创建草稿失败: ${resp.data.errmsg}`);
  }
  
  console.log('   ✓ 草稿创建成功');
  console.log('   media_id:', resp.data.media_id);
  return resp.data.media_id;
}

/**
 * 直接发布（发布接口，订阅号可用）
 */
async function publishDirectly(token, article) {
  console.log('\n📢 使用「发布」接口直接发布...');
  
  // 发布接口需要 articles 参数格式略有不同
  const payload = {
    articles: [article]
  };
  
  const resp = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${token}`,
    JSON.stringify(payload),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    }
  );
  
  if (resp.data.errcode) {
    throw new Error(`发布失败: ${resp.data.errmsg}`);
  }
  
  console.log('   ✓ 发布任务提交成功');
  console.log('   publish_id:', resp.data.publish_id);
  console.log('   msg_data_id:', resp.data.msg_data_id);
  return resp.data;
}

/**
 * 查询发布状态
 */
async function getPublishStatus(token, publishId) {
  const resp = await axios.post(
    `https://api.weixin.qq.com/cgi-bin/freepublish/get?access_token=${token}`,
    JSON.stringify({ publish_id: publishId }),
    {
      headers: {
        'Content-Type': 'application/json; charset=utf-8'
      }
    }
  );
  
  return resp.data;
}

/**
 * 主函数
 */
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('  微信公众号发布工具（订阅号兼容版）');
  console.log('═══════════════════════════════════════\n');
  
  if (!APPID || !APPSECRET) {
    console.error('❌ 错误：请配置 WECHAT_APPID 和 WECHAT_APPSECRET');
    process.exit(1);
  }
  
  const token = await getAccessToken();
  
  // 示例：发布数据库中的文章
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data/news.db');
  const db = new sqlite3.Database(dbPath);
  
  const article = await new Promise((resolve, reject) => {
    db.get(`
      SELECT n.*, s.name as source_name
      FROM news n
      JOIN sources s ON n.source_id = s.id
      WHERE n.rewritten_title IS NOT NULL
      ORDER BY n.id DESC
      LIMIT 1
    `, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
  
  db.close();
  
  if (!article) {
    console.log('❌ 没有找到已改写的文章');
    return;
  }
  
  console.log('\n📄 文章信息：');
  console.log('   标题:', article.rewritten_title);
  console.log('   字数:', article.rewritten_content?.length || 0);
  
  // 准备文章内容
  let htmlContent = article.rewritten_content
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
  
  htmlContent += `<br><br><hr><br>原文链接：<a href="${article.link}">点击查看</a><br>文章来源：${article.source_name}`;
  
  // 使用默认封面或上传新封面
  let thumbMediaId = '';
  const coverPath = 'cover_18yo_entrepreneur.jpg';
  if (fs.existsSync(coverPath)) {
    thumbMediaId = await uploadCoverImage(token, coverPath);
  }
  
  // 构建文章对象
  const articleData = {
    title: article.rewritten_title.substring(0, 64),
    author: 'AI助手',
    digest: article.description?.substring(0, 120) || '',
    content: htmlContent,
    thumb_media_id: thumbMediaId,
    show_cover_pic: 1,
    need_open_comment: 0,
    only_fans_can_comment: 0
  };
  
  // 先尝试草稿箱接口
  let result = await createDraft(token, articleData);
  
  // 如果草稿箱接口失败，使用发布接口
  if (!result) {
    result = await publishDirectly(token, articleData);
    
    console.log('\n⏳ 发布状态说明：');
    console.log('   发布任务已提交，微信会进行审核');
    console.log('   可以使用 publish_id 查询发布状态');
    console.log('   通常几分钟到几小时内完成');
  }
  
  console.log('\n✅ 操作完成！');
  console.log('\n📱 请登录微信公众平台查看：');
  console.log('   https://mp.weixin.qq.com');
  
  if (result.media_id) {
    console.log('   路径：内容与互动 → 草稿箱');
  } else {
    console.log('   路径：内容与互动 → 发表记录');
  }
}

main().catch(err => {
  console.error('\n❌ 错误:', err.message);
  process.exit(1);
});
