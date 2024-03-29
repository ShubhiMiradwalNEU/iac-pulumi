"use strict";
const pulumi = require("@pulumi/pulumi");
const aws = require("@pulumi/aws");
const config = new pulumi.Config();
const vpcCidrBlockk = config.require("vpcCidrBlock");
const publicSubnetCidrBase = config.require("publicSubnetCidrBase");
const privateSubnetCidrBase = config.require("privateSubnetCidrBase");
const subnetCidrOffset = config.require("subnetCidrOffset");
const destinationCidrBlock = config.require("destinationCidrBlock");
const AWS_REGION = config.require("AWS_REGION");
const ami_id= config.require("ami_id");
const domainname=config.require("domain");
const gcp = require("@pulumi/gcp");
const apiKey = config.require("ApiKey");
const MAIL_DOMAIN = config.require("maindomain");
const senderEmailId = "shubhimiradwal2304@gmail.com";

async function createVPC() {
    const vpc = await new aws.ec2.Vpc("main", {
      cidrBlock: vpcCidrBlockk,
      instanceTenancy: "default",
      tags: {
        Name: "main",
      },
      region: AWS_REGION,
    });
    return vpc;
  }

  async function createInternetGateway(vpcId) {
    const internetGateway = await new aws.ec2.InternetGateway("gw", {
      vpcId: vpcId,
      tags: {
        Name: "main",
      },
    });
    return internetGateway;
  }
  

  async function createPublicRouteTable(vpcId, internetGatewayid) {
    const publicRouteTable = await new aws.ec2.RouteTable("public-rt", {
      vpcId: vpcId,
      tags: {
        Name: "public-rt",
      },
      gatewayId: internetGatewayid,

    });
    return publicRouteTable;
  }


  
  async function createPrivateRouteTable(vpcId) {
    const privateRouteTable = await new aws.ec2.RouteTable("private-rt", {
      vpcId: vpcId,
      tags: {
        Name: "private-rt",
      },
    });
    return privateRouteTable;
  }


    async function createPublicSubnet(vpcId) {
        const availableZones = await aws.getAvailabilityZones();
        const numberofAZ = availableZones.names.length;
        let publicSubnets=[];
        console.log(numberofAZ);
        for (let i = 0; i < Math.min(3,numberofAZ); i++) {
            const publicSubnet = await new aws.ec2.Subnet(`publicsubnet-${i}`, {
                vpcId: vpcId,
                cidrBlock: `${publicSubnetCidrBase}${i}.0/24`,
                availabilityZone: availableZones.names[i],
                mapPublicIpOnLaunch: true,
                
            });
            publicSubnets.push(publicSubnet.id)
        }
        return publicSubnets;

    }

    async function createPublicRoute(i, routeTableId, destinationCidrBlock, gatewayId) {
        return new aws.ec2.Route(`publicroute`, {
            routeTableId: routeTableId,
            destinationCidrBlock: destinationCidrBlock,
            gatewayId: gatewayId,
        });
    }
    


        async function createPrivateSubnet(vpcId) {
            const availableZones = await aws.getAvailabilityZones();
            const numberofAZ = availableZones.names.length;
            let privateSubnets=[];
            for (let i = 0; i < Math.min(3,numberofAZ); i++) {
                const privateSubnet = await new aws.ec2.Subnet(`private-${i}`, {
                    vpcId: vpcId,
                    cidrBlock: `${privateSubnetCidrBase}${i+3}.0/24`,
                    availabilityZone: availableZones.names[i],
                    mapPublicIpOnLaunch: true,  
                });
                privateSubnets.push(privateSubnet.id)
            }
            return privateSubnets;
        }




        async function createpublicroutetableassocation(publicSubnets, publicRouteTable) {
            const associations = [];
            for (let i = 0; i < publicSubnets.length; i++) {
                const pubrouteTableAssociation = new aws.ec2.RouteTableAssociation(`publicRouteTableAssociation${i}`, {
                    subnetId: publicSubnets[i],
                    routeTableId: publicRouteTable.id,
                });
                associations.push(pubrouteTableAssociation);
            }
            return associations;
        }
        
        async function createprivateroutetableassociation(privateSubnets, privateRouteTable) {
            const associations = [];

            for (let i = 0; i < privateSubnets.length; i++) {
                const prirouteTableAssociation = new aws.ec2.RouteTableAssociation(`privateRouteTableAssociation${i}`, {
                    subnetId: privateSubnets[i],
                    routeTableId: privateRouteTable.id,
                });
                console.log(privateSubnets[i].id)
                associations.push(prirouteTableAssociation);
            }
            return associations;
        }


        async function createSecurityGroupInVpc(vpcId, elbSecurityGroup) {
            return new aws.ec2.SecurityGroup("application security group", {
                vpcId: vpcId,
                ingress: [
                    {
                    //    securityGroups: [elbSecurityGroup],
                        cidrBlocks: ["0.0.0.0/0"],
                        protocol: "tcp",
                        fromPort: 22,
                        toPort: 22,
                    },

                    {
                        securityGroups: [elbSecurityGroup],
                        protocol: "tcp",
                        fromPort: 8080,
                        toPort: 8080,
                    },
                ],
                egress: [
                    {
                        cidrBlocks: ["0.0.0.0/0"],
                        fromPort: 0,
                        toPort: 0,
                        protocol: "-1",
                    },
                ],
            });
        }

    async function createDbSecurityGroup(vpcID, securityGroup) {
            return new aws.ec2.SecurityGroup("db-security-group", {
                vpcId: vpcID,
                ingress: [
                    {
                        protocol: "tcp",
                        fromPort: 5432,
                        toPort: 5432,
                        securityGroups: [securityGroup.id],
                    },
                ],
                egress: [
                    {
                        protocol: "-1",
                        fromPort: 0,
                        toPort: 0,
                        cidrBlocks: ["0.0.0.0/0"],
            }],
        }
    )};
        async function createParameterGroup() {
            return new aws.rds.ParameterGroup("shubhipar", {
                family: "postgres15",
                description: "Default parameter group for postgres15",  
            });
        }
        
    async function createsubnetgroup(privateSubnet) {
            return new aws.rds.SubnetGroup("db-subnet-group", {
                subnetIds: privateSubnet,
                tags: {
                    Name: "db-subnet-group",
                },
            });
        }

    async function createUserDataScript(username, dbName, port, hostname, password, topicArn) {
            return pulumi.all([username, dbName, port, hostname, password, topicArn]).apply(([username, dbName, port, hostname, password, topicArn]) =>
                `#!/bin/bash          
        
                cd /home/admin/webapp
                touch .env
        
                echo "DB_USER=${username}" >> .env
                echo "DB_NAME=${dbName}" >> .env
                echo "DB_PORT=${port}" >> .env
                echo "NODE_PORT=8080" >> .env
                echo "DB_HOSTNAME=${hostname}" >> .env
                echo "DB_PASSWORD=${password}" >> .env
                echo "SNS_TOPIC_ARN=${topicArn}" >> .env
                echo "IS_SSL=true" >> .env
                echo "NODE_ENV=test" >> .env

               # npx sequelize db:migrate
               sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
               -a fetch-config \
               -m ec2 \
               -c file:/opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent.json \
               -s
                sudo cp /home/admin/webapp/packer/amazon-cloudwatch-agent.json /opt/aws/amazon-cloudwatch-agent/etc/amazon-cloudwatch-agent.json
                sudo systemctl daemon-reload
                `
            );
        }

async function createRDSInstance(para_grp, subnetgrp, securityGroupdb) {
    return new aws.rds.Instance("shubhi", {
        dbSubnetGroupName: subnetgrp.name,
        allocatedStorage: 10,
        dbName: "csye6225",
        engine: "postgres",
        engineVersion: "15.3", 
        instanceClass: "db.t3.micro",
        multiAz: false,
        username: "csye6225",
        password: "shubhi2304",
        skipFinalSnapshot: true,
        publiclyAccessible: false,
        parameterGroupName: para_grp.name,
        vpcSecurityGroupIds: [securityGroupdb.id],
        deletion_protection: false,
        skipFinalSnapshot:true,
    });
}

async function createlbSecurityGroup(vpcId) {
    return new aws.ec2.SecurityGroup("load Balancer", {
        vpcId: vpcId,
        description: "Allow TCP in for load balancer",
        egress: [
            {
                protocol: "-1",
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ["0.0.0.0/0"],
            },
        ],
        ingress: [
            {
                protocol: "tcp",
                fromPort: 80,
                toPort: 80,
                cidrBlocks: ["0.0.0.0/0"],
            },
            {
                protocol: "tcp",
                fromPort: 443,
                toPort: 443,
                cidrBlocks: ["0.0.0.0/0"],
            },
        ],

    
    });
}
   
async function createLaunchTemplate(imageId, userDataScript, publicSubnetId, iamRole, securityGroupId) {
    const userData = pulumi.interpolate`${userDataScript}`.apply(data => Buffer.from(data).toString('base64'));
    const subnetId = Array.isArray(publicSubnetId) ? publicSubnetId[0] : publicSubnetId;
    return new aws.ec2.LaunchTemplate("csye6225_asg", {
        imageId: imageId,
        instanceType: "t2.micro",
        keyName: "admin-aws",
        associatePublicIpAddress: true,
        userData: userData,
        blockDeviceMappings: [
            {
                deviceName: '/dev/xvda',
                ebs: {
                    volumeSize: 8,
                },
            },
        ],
        iamInstanceProfile: {
            name: iamRole,
        },
        monitoring: {
            enabled: true,
        },
        networkInterfaces: [
            {
                securityGroups: [securityGroupId],
                associatePublicIpAddress: true,
                deleteOnTermination: true,
                deviceIndex: 0,
                subnetId: subnetId,
            },
        ],

    });
}

async function createAutoScalingGroup(launchTemplateId, publicSubnet, targetgroup) {
    return new aws.autoscaling.Group("webserver-asg", {
        vpcZoneIdentifiers: publicSubnet,
        desiredCapacity: 1,
        minSize: 1,
        maxSize: 3,
        cooldown: 60,
        launchTemplate: {
            id: launchTemplateId,
            version: "$Latest",
        },
        tags: [
            {
              key: "Name",
              value: "autoScalingGroup",
              propagateAtLaunch: true,
            },
          ],
        dependsOn: [targetgroup],
        targetGroupArns: [targetgroup.arn],

    });
}
async function createTargetGroup(vpcID) {
    return new aws.lb.TargetGroup("webserver-target-group", {
        vpcId:vpcID,
        targetType: "instance",
        protocol: "HTTP",
        port: 8080,
        healthCheck: {
            interval: 30,
            path: "/healthz",
            timeout: 15,
            healthyThreshold: 3,
            unhealthyThreshold: 3,
            matcher: "200",
        },

    });
}
async function createListener(alb, targetGroup) {
    return new aws.lb.Listener("webserver-listener", {
        loadBalancerArn: alb.arn, 
        port              : 80,
        protocol          : "HTTP",
        defaultActions: [{
            type: "forward",
            targetGroupArn: targetGroup.arn,
        }],
    });
}


const createLoadBalancer = async (publicSubnets, loadBalancerSg) => {
    const alb = new aws.lb.LoadBalancer("myLoadBalancer", {
        subnets: publicSubnets,
        securityGroups: [loadBalancerSg.id],
        loadBalancerType : "application",

    });
    return alb;
};


async function createARecord(zoneId,alb) {
    return new aws.route53.Record("web-a-record", {
        name: domainname,
        type: "A",
        zoneId: zoneId,
        aliases: [{
            name: alb.dnsName,
            zoneId: alb.zoneId,
            evaluateTargetHealth: true
        }]
    });
}

async function createScaleUpPolicy(asgName) {
    return new aws.autoscaling.Policy("scaleup", {
        adjustmentType: "ChangeInCapacity",
        cooldown: 300,
        scalingAdjustment: 1,
        policyType: "SimpleScaling",
        autoscalingGroupName: asgName,
    });
}

async function createScaleDownPolicy(asgName) {
    return new aws.autoscaling.Policy("scaledown", {
        
        adjustmentType: "ChangeInCapacity",
        cooldown: 300,
        scalingAdjustment: -1,
        policyType: "SimpleScaling",
        autoscalingGroupName: asgName,
    });
}

async function createLowCPUMetricAlarm(asg, scaleDownPolicyArn) {
    return new aws.cloudwatch.MetricAlarm('cpuLow', {
        comparisonOperator: 'LessThanThreshold',
        evaluationPeriods: 1,
        metricName: 'CPUUtilization',
        namespace: 'AWS/EC2',
        period: 60,
        statistic: 'Average',
        threshold: 3,
        alarmActions: [scaleDownPolicyArn],
        dimensions: {
            AutoScalingGroupName: asg.name,
        },
    });
}

async function createHighCPUMetricAlarm(asg, scaleUpPolicyArn) {
    return new aws.cloudwatch.MetricAlarm("cpuHigh", {
        comparisonOperator: "GreaterThanThreshold",
        evaluationPeriods: 1,
        metricName: "CPUUtilization",
        namespace: "AWS/EC2",
        period: 60,
        statistic: "Average",
        threshold: 5,
        alarmActions: [scaleUpPolicyArn],
        dimensions: {
            AutoScalingGroupName: asg.name,
        },
    });
}

async function createSNSTopic() {
    const topic = new aws.sns.Topic("my-topic");
    return topic.arn;

}

async function createGCSBucket() {
    const bucket = new gcp.storage.Bucket("my-bucket",{
        location: "US",
    });
    return bucket;
}


async function createServiceAccount() {
    const account = new gcp.serviceaccount.Account("webappservice", {
        accountId: "webappservice",
    });
    return account;
}

async function createAccountKey(account) {
    const accountKey = new gcp.serviceaccount.Key("webappservice", {
        serviceAccountId: account.name,
    });
    return accountKey;
}

async function createIAMBinding(serviceAccount) {
    const storageObjectUserRole = "roles/storage.objectCreator";
    const binding = new gcp.projects.IAMBinding("storageObjectViewer", {
        project: pulumi.output(gcp.config.project),
        role: storageObjectUserRole,
        members: [serviceAccount.email.apply(email => `serviceAccount:${email}`)],
    });

    return binding;
}

async function createIamRole() {
    const lambdaRole = new aws.iam.Role("lambdaRole", {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Action: "sts:AssumeRole",
                    Principal: {
                        Service: "lambda.amazonaws.com",
                    },
                    Effect: "Allow",
                    Sid: "",
                },
            ],
        }),
    });


    const lambdaPolicy = new aws.iam.Policy("lambdaPolicy", {
        description: "Policy for Lambda Function",
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Action: "sns:*",
                    Effect: "Allow",
                    Resource: "*",
                },
            ],
        }),
    });
     
    return lambdaRole.arn;
}

async function createEnvironmentVariables(bucket, accountKey) {
    return {
        "GCS_BUCKET": bucket.name,
        "GCS_CREDS": accountKey.privateKey.apply(encoded => Buffer.from(encoded, 'base64').toString('ascii')),
        "MAILGUN_API_KEY": apiKey,  
        "MAILGUN_DOMAIN": MAIL_DOMAIN,
        "SENDER_EMAIL_ID": senderEmailId,
        "CLIENT_EMAIL": accountKey.CLIENT_EMAIL,
    };
}

async function createLambdaFunction(environmentVariables) {
    const roleArn = await createIamRole();
    const lambda = new aws.lambda.Function("lambdaFunction", {
        runtime: "nodejs18.x",
        code: new pulumi.asset.AssetArchive({
            ".": new pulumi.asset.FileArchive("./serverless.zip"),
        }),
        timeout: 5,
        handler: "index.handler",
        role: roleArn,
        environment: {
            variables: environmentVariables,
        },
    });
    return lambda.arn;
};

async function createSnsLambdaSubscription(lambdaFunctionArn, snsTopicArn) {
    new aws.sns.TopicSubscription('snsTopicSub', {
        protocol: 'lambda',
        endpoint: lambdaFunctionArn,
        topic: snsTopicArn,
      });
}

async function createLambdaPermission(topicArn, functionName) {
    return new aws.lambda.Permission("withSns", {
        action: "lambda:InvokeFunction",
        "function": functionName,
        principal: "sns.amazonaws.com",
        sourceArn: topicArn,
    });
}



async function getHostedZone() {
    const zones = await aws.route53.getZone({name: domainname}); 
    return zones;
}

async function createIamRoleWithPolicy(roleName, policyName) {
    const policyDocument = JSON.stringify({
        Version: "2012-10-17",
        "Statement": [
            {
                "Action": [
                    "cloudwatch:PutMetricData",
                    "ec2:DescribeVolumes",
                    "ec2:DescribeTags",
                    "logs:PutLogEvents",
                    "logs:DescribeLogStreams",
                    "logs:DescribeLogGroups",
                    "logs:CreateLogStream",
                    "logs:CreateLogGroup"
                ],
                "Effect": "Allow",
                "Resource": "*"
            }, 
            {
                "Effect": "Allow",
                "Action": [
                    "ssm:GetParameter"
                ],
                "Resource": "arn:aws:ssm:*:*:parameter/AmazonCloudWatch-*"
            }
        ],
    });

    const policy = new aws.iam.Policy(policyName, {
        policy: policyDocument,
        
    });


    const role = new aws.iam.Role(roleName, {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Action: "sts:AssumeRole",
                    Principal: {
                        Service: "ec2.amazonaws.com",
                    },
                    Effect: "Allow",
                    Sid: "",
                },
            ],
        }),
    });


    const rolePolicyAttachment = new aws.iam.RolePolicyAttachment(`${roleName}-${policyName}`, {
        role: role.name,
        policyArn: policy.arn
    });

    const rolePolicyAttachment1 = new aws.iam.RolePolicyAttachment(`${roleName}`, {
        role: role.name,
        policyArn:"arn:aws:iam::aws:policy/AmazonSNSFullAccess"
    });

    

    const instanceProfile = new aws.iam.InstanceProfile(`${roleName}-profile`, {
        role: role.name
    });
    return {arn: role.arn, instanceProfileName: instanceProfile.name};

    

}

async function createDynamoDBTable() {
    const dynamoDB = new aws.dynamodb.Table("dynamodb", {
        attributes: [
            {
                name: "id",
                type: "S",
            },
        ],
        hashKey: "id",
        writeCapacity: 20,
        readCapacity: 20,
    });

    return dynamoDB;
}



const createResource= async()=>
{
    const vpc = await createVPC();
    const internetGateway =  await createInternetGateway(vpc.id);
    const publicRouteTable = await createPublicRouteTable(vpc.id, internetGateway.id);
    const privateRouteTable = await createPrivateRouteTable(vpc.id);
    const privateSubnet = await createPrivateSubnet(vpc.id);
    const publicSubnet = await createPublicSubnet(vpc.id);
    const publicRouteTableAssociation = await createpublicroutetableassocation(publicSubnet,publicRouteTable);
    const privateRouteTableAssociation = await createprivateroutetableassociation(privateSubnet,privateRouteTable);
    const createpublicroutetable= await createPublicRoute(vpc.id, publicRouteTable.id, destinationCidrBlock, internetGateway.id)
    const loadBalancerSg= await createlbSecurityGroup(vpc.id);
    const securityGroup = await createSecurityGroupInVpc(vpc.id, loadBalancerSg.id); 
    const dbSecurityGroup = await createDbSecurityGroup(vpc.id, securityGroup);
    const privateSubnetgroup = await createsubnetgroup(privateSubnet);
    const parameterGroup = await createParameterGroup();
    const rdsinstance= await createRDSInstance(parameterGroup,privateSubnetgroup, dbSecurityGroup);
    const topicArn = await createSNSTopic(); 
    const userDataScript1 = await createUserDataScript(rdsinstance.username,rdsinstance.dbName,rdsinstance.port,rdsinstance.address,rdsinstance.password, topicArn);
    const {arn, instanceProfileName} = await createIamRoleWithPolicy("webapp-role", "webapp-policy");
    const launchTemplate = await createLaunchTemplate(ami_id, userDataScript1, publicSubnet, instanceProfileName,securityGroup);
    const targetGroup = await createTargetGroup(vpc.id);
    const asg = await createAutoScalingGroup(launchTemplate.id,publicSubnet,targetGroup);
    const scaleUpPolicy = await createScaleUpPolicy(asg.name);
    const metricup= await createHighCPUMetricAlarm(asg, scaleUpPolicy.arn);
    const scaleDownPolicy = await createScaleDownPolicy(asg.name);
    const metricdown= await createLowCPUMetricAlarm(asg, scaleDownPolicy.arn);
    const alb=await createLoadBalancer(publicSubnet, loadBalancerSg);
    const listener = await createListener(alb, targetGroup);
    const hostedZoneid = await getHostedZone();
    const aliass = await createARecord(hostedZoneid.zoneId,alb);
    const bucket = await createGCSBucket();
    const serviceAccount = await  createServiceAccount();
    const iamRole = await createIAMBinding(serviceAccount);
    const accountKey = await createAccountKey(serviceAccount);
    const environmentVariables = await createEnvironmentVariables(bucket, accountKey);
    const lambdaFunctionARN = await createLambdaFunction(environmentVariables);
    await createSnsLambdaSubscription(lambdaFunctionARN, topicArn);
    const lambdapermission = await createLambdaPermission(topicArn, lambdaFunctionARN);
    const dynamoDB=await createDynamoDBTable();
}
createResource();

        

  
